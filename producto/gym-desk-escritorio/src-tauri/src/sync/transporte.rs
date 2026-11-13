//! Comunicación con la API del gimnasio. Todo lo que sale a la red pasa por aquí.

use std::time::Duration;

use serde_json::Value;

use crate::error::ErrorApp;

#[derive(Debug, Clone, PartialEq)]
pub enum ErrorTransporte {
    /// No hubo respuesta: sin internet, servidor caído o tiempo agotado. Se reintenta.
    SinConexion(String),
    /// El servidor respondió con un error `{error: {codigo, mensaje, detalles}}`.
    Servidor { status: u16, codigo: String, mensaje: String, detalles: Option<Value> },
}

impl ErrorTransporte {
    pub fn es_sin_conexion(&self) -> bool {
        matches!(self, ErrorTransporte::SinConexion(_))
    }

    pub fn codigo(&self) -> &str {
        match self {
            ErrorTransporte::SinConexion(_) => "SIN_CONEXION",
            ErrorTransporte::Servidor { codigo, .. } => codigo,
        }
    }

    /// Error para mostrar en pantalla.
    pub fn a_error_app(&self) -> ErrorApp {
        match self {
            ErrorTransporte::SinConexion(_) => {
                ErrorApp::nuevo("SIN_CONEXION", "No hay conexión con el servidor. Revisa el internet e intenta de nuevo.")
            }
            ErrorTransporte::Servidor { codigo, mensaje, detalles, .. } => {
                ErrorApp { codigo: codigo.clone(), mensaje: mensaje.clone(), detalles: detalles.clone() }
            }
        }
    }
}

pub enum Metodo {
    Get,
    Post,
}

pub struct Peticion<'a> {
    pub metodo: Metodo,
    /// Ruta bajo `/api/v1`, por ejemplo `/sync/pull`.
    pub ruta: &'a str,
    pub token: Option<&'a str>,
    pub consulta: Vec<(&'a str, String)>,
    pub cuerpo: Option<&'a Value>,
}

pub trait Transporte: Send + Sync {
    fn enviar(&self, base: &str, peticion: Peticion<'_>) -> Result<Value, ErrorTransporte>;
}

/// Dirección de la API de un gimnasio. En producción siempre es su subdominio con HTTPS.
/// Solo en compilaciones de desarrollo se puede apuntar a otra con `GYMDESK_API_URL`.
pub fn base_de_api(subdominio: &str) -> String {
    #[cfg(debug_assertions)]
    if let Ok(url) = std::env::var("GYMDESK_API_URL") {
        if !url.trim().is_empty() {
            return url.trim().trim_end_matches('/').to_string();
        }
    }
    format!("https://{subdominio}.gymdeskcolombia.com/api/v1")
}

pub struct TransporteHttp {
    agente: ureq::Agent,
}

impl Default for TransporteHttp {
    fn default() -> Self {
        Self::nuevo()
    }
}

impl TransporteHttp {
    pub fn nuevo() -> Self {
        let agente = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(8))
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("GymDesk-Escritorio/", env!("CARGO_PKG_VERSION")))
            .build();
        Self { agente }
    }
}

impl Transporte for TransporteHttp {
    fn enviar(&self, base: &str, p: Peticion<'_>) -> Result<Value, ErrorTransporte> {
        let url = format!("{}{}", base.trim_end_matches('/'), p.ruta);
        let mut req = match p.metodo {
            Metodo::Get => self.agente.get(&url),
            Metodo::Post => self.agente.post(&url),
        };
        req = req.set("X-GymDesk-Version", env!("CARGO_PKG_VERSION"));
        if let Some(token) = p.token {
            req = req.set("Authorization", &format!("Bearer {token}"));
        }
        for (clave, valor) in &p.consulta {
            req = req.query(clave, valor);
        }
        let respuesta = match p.cuerpo {
            Some(cuerpo) => req.send_json(cuerpo),
            None => req.call(),
        };
        match respuesta {
            Ok(r) => r.into_json::<Value>().map_err(|e| ErrorTransporte::SinConexion(format!("respuesta ilegible: {e}"))),
            Err(ureq::Error::Status(status, r)) => {
                let cuerpo: Value = r.into_json().unwrap_or(Value::Null);
                let error = &cuerpo["error"];
                Err(ErrorTransporte::Servidor {
                    status,
                    codigo: error["codigo"].as_str().unwrap_or("ERROR_SERVIDOR").to_string(),
                    mensaje: error["mensaje"]
                        .as_str()
                        .unwrap_or("El servidor no pudo atender la solicitud. Intenta de nuevo en un momento.")
                        .to_string(),
                    detalles: error.get("detalles").filter(|d| !d.is_null()).cloned(),
                })
            }
            Err(ureq::Error::Transport(e)) => Err(ErrorTransporte::SinConexion(e.to_string())),
        }
    }
}

#[cfg(test)]
pub mod pruebas {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    /// Servidor HTTP mínimo y real (un socket local) que responde una vez lo que se le indique.
    pub fn servidor_de_una_respuesta(status: &str, cuerpo: &str) -> (String, thread::JoinHandle<String>) {
        let escucha = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/api/v1", escucha.local_addr().unwrap());
        let respuesta = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{cuerpo}",
            cuerpo.len()
        );
        let hilo = thread::spawn(move || {
            let (mut conexion, _) = escucha.accept().unwrap();
            let mut recibido = Vec::new();
            let mut bloque = [0u8; 4096];
            loop {
                let n = conexion.read(&mut bloque).unwrap();
                recibido.extend_from_slice(&bloque[..n]);
                let texto = String::from_utf8_lossy(&recibido).to_string();
                if let Some(fin) = texto.find("\r\n\r\n") {
                    let largo = texto
                        .lines()
                        .find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                        .unwrap_or(0);
                    if recibido.len() >= fin + 4 + largo {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            conexion.write_all(respuesta.as_bytes()).unwrap();
            String::from_utf8_lossy(&recibido).to_string()
        });
        (base, hilo)
    }

    #[test]
    fn una_respuesta_correcta_llega_como_json_y_la_peticion_lleva_token_y_consulta() {
        let (base, hilo) = servidor_de_una_respuesta("200 OK", r#"{"hay_mas":false}"#);
        let r = TransporteHttp::nuevo()
            .enviar(
                &base,
                Peticion { metodo: Metodo::Get, ruta: "/sync/pull", token: Some("tok-123"), consulta: vec![("limite", "50".into())], cuerpo: None },
            )
            .unwrap();
        assert_eq!(r["hay_mas"], false);
        let pedido = hilo.join().unwrap();
        assert!(pedido.starts_with("GET /api/v1/sync/pull?limite=50 "), "{pedido}");
        assert!(pedido.to_lowercase().contains("authorization: bearer tok-123"));
    }

    #[test]
    fn un_error_del_servidor_conserva_codigo_mensaje_y_detalles() {
        let cuerpo = r#"{"success":false,"error":{"codigo":"GIMNASIO_SUSPENDIDO","mensaje":"El servicio del gimnasio no está disponible","detalles":{"motivo":"falta_pago"}}}"#;
        let (base, hilo) = servidor_de_una_respuesta("403 Forbidden", cuerpo);
        let cuerpo_envio = serde_json::json!({"operaciones": []});
        let err = TransporteHttp::nuevo()
            .enviar(&base, Peticion { metodo: Metodo::Post, ruta: "/sync/push", token: None, consulta: vec![], cuerpo: Some(&cuerpo_envio) })
            .unwrap_err();
        hilo.join().unwrap();
        match err {
            ErrorTransporte::Servidor { status, codigo, detalles, .. } => {
                assert_eq!((status, codigo.as_str()), (403, "GIMNASIO_SUSPENDIDO"));
                assert_eq!(detalles.unwrap()["motivo"], "falta_pago");
            }
            otro => panic!("se esperaba error del servidor: {otro:?}"),
        }
    }

    #[test]
    fn si_nadie_responde_es_sin_conexion_y_no_un_error_del_servidor() {
        // Puerto recién liberado: nadie escucha.
        let puerto = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let err = TransporteHttp::nuevo()
            .enviar(
                &format!("http://127.0.0.1:{puerto}/api/v1"),
                Peticion { metodo: Metodo::Get, ruta: "/sync/pull", token: None, consulta: vec![], cuerpo: None },
            )
            .unwrap_err();
        assert!(err.es_sin_conexion(), "{err:?}");
        assert_eq!(err.a_error_app().codigo, "SIN_CONEXION");
    }

    #[test]
    fn en_produccion_la_api_es_el_subdominio_del_gimnasio_por_https() {
        std::env::remove_var("GYMDESK_API_URL");
        assert_eq!(base_de_api("powergym"), "https://powergym.gymdeskcolombia.com/api/v1");
    }
}
