import { apiClient } from './client';
import { PantallaConfig } from '../types/tenant.types';

export interface DisplayDataResponse {
  nombre_gimnasio: string;
  subdominio: string;
  logo_url: string | null;
  hora_actual_bogota: string;
  avisos: string[];
  tiempo_saludo_segundos: number;
  clases_del_dia: Array<{
    id: string;
    nombre: string;
    tipo: string;
    hora_inicio: string;
    hora_fin?: string;
    entrenador_nombre?: string;
    cupo_maximo: number;
    cupos_disponibles: number;
  }>;
}

export interface PantallaTvWsEvent {
  tipo: 'CONECTADO' | 'CHECKIN_EVENTO' | 'CONFIG_ACTUALIZADA' | string;
  mensaje?: string;
  gimnasio?: string;
  subdominio?: string;
  deportista?: {
    nombre: string;
    documento: string;
    estado_calculado: string;
    dias_restantes_o_vencido?: number;
  };
  configuracion?: PantallaConfig;
  ts_local?: string;
}

export type PantallaTvWsStatus =
  | 'conectando'
  | 'conectado'
  | 'reconectando'
  | 'desconectado'
  | 'error_token';

export interface PantallaTvWsOptions {
  subdominio: string;
  deviceToken: string;
  onMessage?: (event: PantallaTvWsEvent) => void;
  onStatusChange?: (status: PantallaTvWsStatus, detail?: { attempt: number; delayMs: number }) => void;
}

export class PantallaTvWebSocketClient {
  private subdominio: string;
  private deviceToken: string;
  private onMessage?: (event: PantallaTvWsEvent) => void;
  private onStatusChange?: (status: PantallaTvWsStatus, detail?: { attempt: number; delayMs: number }) => void;

  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private pingInterval: any = null;
  private reconnectTimeout: any = null;
  private isClosedManually = false;

  constructor(options: PantallaTvWsOptions) {
    this.subdominio = options.subdominio;
    this.deviceToken = options.deviceToken;
    this.onMessage = options.onMessage;
    this.onStatusChange = options.onStatusChange;
  }

  public connect(): void {
    this.isClosedManually = false;
    this.clearTimers();

    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
    // Convert http/https to ws/wss
    const wsProtocol = baseUrl.startsWith('https') ? 'wss' : 'ws';
    const cleanHostPath = baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const wsUrl = `${wsProtocol}://${cleanHostPath}/pantalla-tv/ws/${encodeURIComponent(
      this.subdominio
    )}?device_token=${encodeURIComponent(this.deviceToken)}`;

    this.onStatusChange?.('conectando');

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.onStatusChange?.('conectado');
        this.startHeartbeat();
      };

      this.ws.onmessage = (ev: MessageEvent) => {
        if (ev.data === 'pong') {
          return;
        }
        try {
          const parsed = JSON.parse(ev.data);
          this.onMessage?.(parsed);
        } catch (e) {
          console.warn('[Pantalla TV WS] Error parsing payload:', ev.data, e);
        }
      };

      this.ws.onclose = (ev: CloseEvent) => {
        this.clearHeartbeat();

        // Status code 1008 = WS_1008_POLICY_VIOLATION (Invalid or unauthorized device_token)
        if (ev.code === 1008) {
          this.onStatusChange?.('error_token');
          return;
        }

        if (!this.isClosedManually) {
          this.scheduleReconnect();
        } else {
          this.onStatusChange?.('desconectado');
        }
      };

      this.ws.onerror = (err) => {
        console.warn('[Pantalla TV WS] Error en socket:', err);
      };
    } catch (e) {
      console.error('[Pantalla TV WS] Excepción al inicializar WebSocket:', e);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    // RNF-06: Backoff exponencial: 1s, 2s, 4s, 8s, 16s... hasta 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.onStatusChange?.('reconectando', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, 15000);
  }

  private clearHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  public disconnect(): void {
    this.isClosedManually = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.close(1000, 'Cierre normal por cliente');
      this.ws = null;
    }
    this.onStatusChange?.('desconectado');
  }

  public updateCredentials(subdominio: string, deviceToken: string): void {
    this.subdominio = subdominio;
    this.deviceToken = deviceToken;
    this.reconnectAttempts = 0;
    this.connect();
  }
}

export const pantallaTvService = {
  async getDisplayData(subdominio: string): Promise<DisplayDataResponse> {
    const response = await apiClient.get<DisplayDataResponse>(`/pantalla-tv/display/${subdominio}`);
    return response.data;
  },

  async getConfig(): Promise<PantallaConfig> {
    const response = await apiClient.get<PantallaConfig>('/pantalla-tv/config');
    return response.data;
  },

  async updateConfig(config: Partial<PantallaConfig>): Promise<PantallaConfig> {
    const response = await apiClient.put<PantallaConfig>('/pantalla-tv/config', config);
    return response.data;
  },

  async regenerarDeviceToken(): Promise<{ device_token: string; mensaje: string }> {
    const response = await apiClient.post('/pantalla-tv/regenerar-token');
    return response.data;
  },

  async testSaludo(deportistaNombre: string): Promise<any> {
    const response = await apiClient.post('/pantalla-tv/test-saludo', { nombre: deportistaNombre });
    return response.data;
  },

  connectWebSocket(options: PantallaTvWsOptions): PantallaTvWebSocketClient {
    const client = new PantallaTvWebSocketClient(options);
    client.connect();
    return client;
  },
};
