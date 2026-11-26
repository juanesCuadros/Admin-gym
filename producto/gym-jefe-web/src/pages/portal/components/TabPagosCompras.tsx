import React from 'react';
import { CreditCard, ShoppingBag } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { formatCOP, formatFecha, formatFechaHora, plural } from '../../../utils/formato';
import type { FinanzasDeportistaResponse } from '../../../types/portal.types';

interface TabPagosComprasProps {
  finanzas: FinanzasDeportistaResponse;
}

export const TabPagosCompras: React.FC<TabPagosComprasProps> = ({ finanzas }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* KPIs de Finanzas (2 cols en móvil) */}
      <div className="portal-kpi-grid">
        <div className="card portal-kpi-card">
          <div>
            <div className="portal-kpi-title" style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Total Invertido en Membresías
            </div>
            <div className="portal-kpi-val" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary)', marginTop: 4 }}>
              {formatCOP(Number(finanzas.total_invertido_membresias))}
            </div>
          </div>
          <div className="portal-kpi-sub" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {plural(finanzas.cantidad_pagos_membresia, 'pago registrado', 'pagos registrados')}
          </div>
        </div>

        <div className="card portal-kpi-card">
          <div>
            <div className="portal-kpi-title" style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Total en Tienda / Productos
            </div>
            <div className="portal-kpi-val" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
              {formatCOP(Number(finanzas.total_compras_tienda))}
            </div>
          </div>
          <div className="portal-kpi-sub" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {plural(finanzas.cantidad_compras_tienda, 'compra', 'compras')} en recepción
          </div>
        </div>
      </div>

      {/* Pagos de Membresías (Desktop Table + Mobile Cards) */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <CreditCard size={18} style={{ color: 'var(--primary)' }} />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
            Historial de Pagos de Membresías ({finanzas.pagos_membresias.length})
          </h3>
        </div>

        {finanzas.pagos_membresias.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
            No tienes pagos de membresía registrados.
          </div>
        ) : (
          <>
            {/* Vista Desktop (Tabla) */}
            <div className="portal-desktop-only">
              <div className="table-responsive">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Fecha de Pago</th>
                      <th>Plan</th>
                      <th>Vigencia</th>
                      <th className="col-num">Días</th>
                      <th>Método</th>
                      <th className="col-num">Monto</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finanzas.pagos_membresias.map((pm) => (
                      <tr key={pm.id}>
                        <td>{formatFechaHora(pm.created_at)}</td>
                        <td>{pm.plan_nombre}</td>
                        <td>
                          {pm.fecha_inicio && pm.fecha_vencimiento
                            ? `${formatFecha(pm.fecha_inicio)} – ${formatFecha(pm.fecha_vencimiento)}`
                            : formatFecha(pm.created_at)}
                        </td>
                        <td className="col-num">+{pm.dias_agregados}</td>
                        <td style={{ textTransform: 'capitalize' }}>{pm.metodo}</td>
                        <td className="col-num" style={{ fontWeight: 600 }}>{formatCOP(Number(pm.monto))}</td>
                        <td>
                          <Badge variant={pm.anulado ? 'danger' : 'success'}>
                            {pm.anulado ? 'Anulado' : 'Pagado'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Vista Móvil (Tarjetas de cada pago) */}
            <div className="portal-mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {finanzas.pagos_membresias.map((pm) => (
                <div key={pm.id} className="portal-mobile-table-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.94rem' }}>{pm.plan_nombre}</span>
                    <Badge variant={pm.anulado ? 'danger' : 'success'}>
                      {pm.anulado ? 'Anulado' : 'Pagado'}
                    </Badge>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>Monto abonado:</span>
                    <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--primary)' }}>
                      {formatCOP(Number(pm.monto))}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '6px 10px',
                      fontSize: '0.78rem',
                      paddingTop: 6,
                      borderTop: '1px solid var(--border-color)',
                    }}
                  >
                    <div>
                      <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Vigencia asignada:</span>
                      <span style={{ fontWeight: 500 }}>
                        {pm.fecha_inicio && pm.fecha_vencimiento
                          ? `${formatFecha(pm.fecha_inicio)} – ${formatFecha(pm.fecha_vencimiento)}`
                          : formatFecha(pm.created_at)}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)', display: 'block' }}>Método:</span>
                      <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>
                        {pm.metodo} (+{pm.dias_agregados} días)
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Compras en Tienda (Desktop Table + Mobile Cards) */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <ShoppingBag size={18} style={{ color: 'var(--primary)' }} />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
            Mis Compras en Tienda ({finanzas.compras_tienda.length})
          </h3>
        </div>

        {finanzas.compras_tienda.length === 0 ? (
          <div
            style={{
              padding: '28px 16px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'var(--bg-surface-elevated)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
              }}
            >
              <ShoppingBag size={24} />
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
              No tienes compras de productos registradas
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Tus consumos en recepción aparecerán listados aquí.
            </div>
          </div>
        ) : (
          <>
            <div className="portal-desktop-only">
              <div className="table-responsive">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Detalle de Productos / Ítems</th>
                      <th>Método de Pago</th>
                      <th className="col-num">Total</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finanzas.compras_tienda.map((compra) => (
                      <tr key={compra.id}>
                        <td>{formatFechaHora(compra.created_at)}</td>
                        <td>
                          {compra.items.length === 0 ? (
                            'Compra en recepción'
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {compra.items.map((it) => (
                                <span key={it.id} style={{ fontSize: '0.84rem' }}>
                                  <strong>{it.cantidad}x</strong> {it.descripcion} ({formatCOP(Number(it.subtotal))})
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ textTransform: 'capitalize' }}>{compra.metodo}</td>
                        <td className="col-num" style={{ fontWeight: 600 }}>{formatCOP(Number(compra.total))}</td>
                        <td>
                          <Badge variant={compra.anulada ? 'danger' : 'success'}>
                            {compra.anulada ? 'Anulada' : 'Completada'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="portal-mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {finanzas.compras_tienda.map((compra) => (
                <div key={compra.id} className="portal-mobile-table-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{formatFechaHora(compra.created_at)}</span>
                    <Badge variant={compra.anulada ? 'danger' : 'success'}>
                      {compra.anulada ? 'Anulada' : 'Completada'}
                    </Badge>
                  </div>
                  <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                    {compra.items.map((it) => `${it.cantidad}x ${it.descripcion}`).join(', ') || 'Compra en recepción'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 4, borderTop: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: '0.78rem', textTransform: 'capitalize', color: 'var(--text-muted)' }}>
                      {compra.metodo}
                    </span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--primary)' }}>
                      {formatCOP(Number(compra.total))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

