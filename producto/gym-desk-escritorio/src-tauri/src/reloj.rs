//! Tiempo de la estación. Los instantes se guardan en UTC; la fecha de negocio
//! siempre es la de America/Bogota. Nada en la app lee la hora por fuera de este módulo.

use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use chrono_tz::America::Bogota;

pub trait Reloj: Send + Sync {
    fn ahora(&self) -> DateTime<Utc>;
}

pub struct RelojSistema;

impl Reloj for RelojSistema {
    fn ahora(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// Fecha de negocio (corte de día a medianoche de Bogotá) de un instante.
pub fn fecha_negocio(instante: DateTime<Utc>) -> NaiveDate {
    instante.with_timezone(&Bogota).date_naive()
}

/// Texto ISO-8601 en UTC con milisegundos. Ordena igual como texto que como fecha.
pub fn a_texto(instante: DateTime<Utc>) -> String {
    instante.to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
pub mod pruebas {
    use super::*;
    use chrono::Duration;
    use std::sync::Mutex;

    /// Reloj que solo avanza cuando la prueba lo indica.
    pub struct RelojFijo(Mutex<DateTime<Utc>>);

    impl RelojFijo {
        pub fn en(texto: &str) -> Self {
            Self(Mutex::new(texto.parse().expect("instante ISO-8601 válido")))
        }

        pub fn avanzar(&self, d: Duration) {
            let mut g = self.0.lock().unwrap();
            *g += d;
        }
    }

    impl Reloj for RelojFijo {
        fn ahora(&self) -> DateTime<Utc> {
            *self.0.lock().unwrap()
        }
    }

    #[test]
    fn a_las_19_30_de_bogota_la_fecha_de_negocio_es_la_de_bogota() {
        // 00:30 UTC del 13 = 19:30 del 12 en Bogotá (GW-RNF-07).
        let instante: DateTime<Utc> = "2026-11-13T00:30:00Z".parse().unwrap();
        assert_eq!(fecha_negocio(instante), NaiveDate::from_ymd_opt(2026, 11, 12).unwrap());
    }

    #[test]
    fn a_medianoche_de_bogota_cambia_la_fecha_de_negocio() {
        let antes: DateTime<Utc> = "2026-11-13T04:59:59Z".parse().unwrap();
        let despues: DateTime<Utc> = "2026-11-13T05:00:00Z".parse().unwrap();
        assert_eq!(fecha_negocio(antes), NaiveDate::from_ymd_opt(2026, 11, 12).unwrap());
        assert_eq!(fecha_negocio(despues), NaiveDate::from_ymd_opt(2026, 11, 13).unwrap());
    }

    #[test]
    fn el_texto_de_un_instante_ordena_igual_que_la_fecha() {
        let a = a_texto("2026-11-12T09:00:00Z".parse().unwrap());
        let b = a_texto("2026-11-12T10:00:00.5Z".parse().unwrap());
        assert_eq!(a, "2026-11-12T09:00:00.000Z");
        assert!(a < b);
    }
}
