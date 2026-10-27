import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, PackagePlus, SlidersHorizontal, History, Power } from 'lucide-react';
import { inventarioService } from '../../api/inventario.service';
import { ApiError, toApiError } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea, SearchInput } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Drawer } from '../../components/ui/Drawer';
import { MenuAcciones } from '../../components/ui/MenuAcciones';
import { Table } from '../../components/ui/Table';
import { Cargando, Conflicto, ErrorCarga, MensajeFijo, VacioFiltro, VacioInicial } from '../../components/estados/Estados';
import { FILAS_POR_PAGINA, formatCOP, formatFechaHora } from '../../utils/formato';
import type { ProductoResponse, StockMovimientoResponse } from '../../types/inventario.types';
import { ETIQUETA_MOVIMIENTO, VARIANTE_MOVIMIENTO } from './movimientos';

/** Umbral de "stock crítico" del backend (`bajo_stock`: stock menor o igual a 5). */
const STOCK_CRITICO = 5;

type Dialogo =
  | { tipo: 'crear' }
  | { tipo: 'editar'; p: ProductoResponse }
  | { tipo: 'entrada'; p: ProductoResponse }
  | { tipo: 'ajuste'; p: ProductoResponse }
  | { tipo: 'kardex'; p: ProductoResponse }
  | null;

const esEntero = (v: string) => v.trim() !== '' && Number.isInteger(Number(v));

/* -------------------------------------------------------------------------- */
/* Movimientos de un producto (kardex)                                         */
/* -------------------------------------------------------------------------- */

const KardexProducto: React.FC<{ producto: ProductoResponse }> = ({ producto }) => {
  const [pagina, setPagina] = useState(1);
  const [items, setItems] = useState<StockMovimientoResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await inventarioService.kardexProducto(producto.id, {
        limit: FILAS_POR_PAGINA,
        offset: (pagina - 1) * FILAS_POR_PAGINA,
      });
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [producto.id, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) return <ErrorCarga error={error} onReintentar={cargar} />;
  return (
    <Table<StockMovimientoResponse>
      data={items}
      isLoading={cargando}
      keyExtractor={(m) => m.id}
      emptyMessage="Este producto aún no tiene movimientos"
      pagination={{
        currentPage: pagina,
        totalPages: Math.max(1, Math.ceil(total / FILAS_POR_PAGINA)),
        onPageChange: setPagina,
      }}
      columns={[
        { header: 'Fecha', render: (m) => formatFechaHora(m.created_at) },
        {
          header: 'Tipo',
          render: (m) => <Badge variant={VARIANTE_MOVIMIENTO[m.tipo] ?? 'neutral'}>{ETIQUETA_MOVIMIENTO[m.tipo] ?? m.tipo}</Badge>,
        },
        {
          header: 'Cantidad',
          align: 'right',
          render: (m) => (
            <strong style={{ color: m.cantidad < 0 ? 'var(--danger)' : 'var(--success)' }}>
              {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
            </strong>
          ),
        },
        { header: 'Motivo', render: (m) => m.motivo || '—' },
        { header: 'Registró', render: (m) => m.registrado_por_nombre || '—' },
      ]}
    />
  );
};

/* -------------------------------------------------------------------------- */
/* Página                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Inventario · Productos (GW-RF-36, GW-RF-37).
 * Catálogo con precio y stock; entradas y ajustes con motivo quedan en el kardex y en auditoría.
 */
export const ProductosPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const puedeCrear = hasPermission('inventario', 'crear');
  const puedeEditar = hasPermission('inventario', 'editar');

  // Listado
  const [buscar, setBuscar] = useState('');
  const [buscarAplicado, setBuscarAplicado] = useState('');
  const [estado, setEstado] = useState<'' | 'activo' | 'inactivo'>('');
  const [bajoStock, setBajoStock] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [items, setItems] = useState<ProductoResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);
  const hayFiltros = !!buscarAplicado || !!estado || bajoStock;

  useEffect(() => {
    const t = window.setTimeout(() => {
      setBuscarAplicado(buscar.trim());
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await inventarioService.listarProductos({
        buscar: buscarAplicado || undefined,
        activo: estado === '' ? undefined : estado === 'activo',
        bajo_stock: bajoStock || undefined,
        limit: FILAS_POR_PAGINA,
        offset: (pagina - 1) * FILAS_POR_PAGINA,
      });
      setItems(res.items);
      setTotal(res.total);
      setErrorCarga(null);
    } catch (e) {
      setErrorCarga(e);
    } finally {
      setCargando(false);
    }
  }, [buscarAplicado, estado, bajoStock, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const limpiarFiltros = () => {
    setBuscar('');
    setBuscarAplicado('');
    setEstado('');
    setBajoStock(false);
    setPagina(1);
  };

  // Diálogos
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  const [stockInicial, setStockInicial] = useState('0');
  const [cantidad, setCantidad] = useState('');
  const [sentidoAjuste, setSentidoAjuste] = useState<'sumar' | 'restar'>('restar');
  const [motivo, setMotivo] = useState('');
  const [tocados, setTocados] = useState<Record<string, boolean>>({});
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<ApiError | null>(null);
  const [aDesactivar, setADesactivar] = useState<ProductoResponse | null>(null);

  const abrir = (d: NonNullable<Dialogo>) => {
    setErrorGuardar(null);
    setTocados({});
    setCantidad('');
    setMotivo('');
    setSentidoAjuste('restar');
    if (d.tipo === 'crear') {
      setNombre('');
      setPrecio('');
      setStockInicial('0');
    } else if (d.tipo === 'editar') {
      setNombre(d.p.nombre);
      setPrecio(String(Math.round(Number(d.p.precio))));
    }
    setDialogo(d);
  };

  const cerrar = () => !guardando && setDialogo(null);

  // ---- Validación por diálogo ----
  const errores: Record<string, string> = {};
  if (dialogo?.tipo === 'crear' || dialogo?.tipo === 'editar') {
    const n = nombre.trim();
    if (n.length < 2) errores.nombre = 'El nombre debe tener al menos 2 caracteres.';
    else if (n.length > 150) errores.nombre = 'Máximo 150 caracteres.';
    if (!esEntero(precio) || Number(precio) < 0) errores.precio = 'Escribe el precio en pesos, sin decimales.';
    if (dialogo.tipo === 'crear' && (!esEntero(stockInicial) || Number(stockInicial) < 0))
      errores.stock_inicial = 'El stock inicial debe ser 0 o más.';
  }
  if (dialogo?.tipo === 'entrada') {
    if (!esEntero(cantidad) || Number(cantidad) <= 0) errores.cantidad = 'La cantidad debe ser un entero mayor que 0.';
    if (motivo.length > 255) errores.motivo = 'Máximo 255 caracteres.';
  }
  if (dialogo?.tipo === 'ajuste') {
    if (!esEntero(cantidad) || Number(cantidad) <= 0) errores.cantidad = 'La cantidad debe ser un entero mayor que 0.';
    else if (sentidoAjuste === 'restar' && Number(cantidad) > dialogo.p.stock)
      errores.cantidad = `No puedes restar más de lo que hay en stock (${dialogo.p.stock}).`;
    if (motivo.trim().length < 10) errores.motivo = 'El ajuste exige un motivo de al menos 10 caracteres.';
    else if (motivo.length > 255) errores.motivo = 'Máximo 255 caracteres.';
  }
  const err = (c: string) => (tocados[c] ? errores[c] : undefined) ?? errorGuardar?.campos[c];
  const tocar = (c: string) => setTocados((t) => ({ ...t, [c]: true }));

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialogo) return;
    setTocados({ nombre: true, precio: true, stock_inicial: true, cantidad: true, motivo: true });
    if (Object.keys(errores).length > 0 || guardando) return;
    setGuardando(true);
    setErrorGuardar(null);
    try {
      if (dialogo.tipo === 'crear') {
        const p = await inventarioService.crearProducto({
          nombre: nombre.trim(),
          precio: Number(precio),
          stock_inicial: Number(stockInicial),
        });
        showToast('success', 'Producto creado', p.nombre);
      } else if (dialogo.tipo === 'editar') {
        await inventarioService.actualizarProducto(dialogo.p.id, {
          nombre: nombre.trim(),
          precio: Number(precio),
          version: dialogo.p.version,
        });
        showToast('success', 'Producto actualizado', nombre.trim());
      } else if (dialogo.tipo === 'entrada') {
        await inventarioService.registrarEntrada(dialogo.p.id, {
          cantidad: Number(cantidad),
          motivo: motivo.trim() || undefined,
        });
        showToast('success', 'Entrada registrada', `+${cantidad} ${dialogo.p.nombre}`);
      } else if (dialogo.tipo === 'ajuste') {
        const n = Number(cantidad) * (sentidoAjuste === 'restar' ? -1 : 1);
        await inventarioService.registrarAjuste(dialogo.p.id, { cantidad: n, motivo: motivo.trim() });
        showToast('success', 'Ajuste registrado', `${n > 0 ? '+' : ''}${n} ${dialogo.p.nombre}`);
      }
      setDialogo(null);
      cargar();
    } catch (e2) {
      setErrorGuardar(toApiError(e2));
    } finally {
      setGuardando(false);
    }
  };

  const cambiarEstado = async (p: ProductoResponse, activo: boolean) => {
    setGuardando(true);
    try {
      await inventarioService.cambiarEstadoProducto(p.id, activo);
      showToast('success', activo ? 'Producto activado' : 'Producto desactivado', p.nombre);
      setADesactivar(null);
      cargar();
    } catch (e) {
      showToast('error', 'No se pudo cambiar el estado', toApiError(e).message);
    } finally {
      setGuardando(false);
    }
  };

  // ---- Render ----
  let contenido: React.ReactNode;
  if (cargando && items.length === 0 && !errorCarga) contenido = <Cargando />;
  else if (errorCarga) contenido = <ErrorCarga error={errorCarga} onReintentar={cargar} />;
  else if (total === 0 && !hayFiltros)
    contenido = (
      <VacioInicial
        titulo="Aún no hay productos"
        descripcion="Registra lo que vendes en recepción (bebidas, suplementos, accesorios) con su precio y stock inicial."
        textoAccion={puedeCrear ? 'Crear producto' : undefined}
        onAccion={puedeCrear ? () => abrir({ tipo: 'crear' }) : undefined}
      />
    );
  else if (total === 0) contenido = <VacioFiltro onLimpiar={limpiarFiltros} />;
  else
    contenido = (
      <Card>
        <Table<ProductoResponse>
          data={items}
          isLoading={cargando}
          keyExtractor={(p) => p.id}
          pagination={{
            currentPage: pagina,
            totalPages: Math.max(1, Math.ceil(total / FILAS_POR_PAGINA)),
            onPageChange: setPagina,
          }}
          columns={[
            { header: 'Producto', render: (p) => <span style={{ fontWeight: 500 }}>{p.nombre}</span> },
            { header: 'Precio', align: 'right', render: (p) => formatCOP(p.precio) },
            {
              header: 'Stock',
              align: 'right',
              render: (p) => (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {p.stock <= 0 ? (
                    <Badge variant="danger">Agotado</Badge>
                  ) : p.stock <= STOCK_CRITICO ? (
                    <Badge variant="warning">Stock bajo</Badge>
                  ) : null}
                  <strong>{p.stock}</strong>
                </div>
              ),
            },
            {
              header: 'Estado',
              render: (p) => <Badge variant={p.activo ? 'success' : 'neutral'}>{p.activo ? 'Activo' : 'Desactivado'}</Badge>,
            },
            {
              header: '',
              align: 'right',
              width: '150px',
              render: (p) => (
                <div className="acciones-fila">
                  {puedeEditar ? (
                    <Button variant="secondary" size="sm" leftIcon={<PackagePlus size={14} />} onClick={() => abrir({ tipo: 'entrada', p })}>
                      Entrada
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" leftIcon={<History size={14} />} onClick={() => abrir({ tipo: 'kardex', p })}>
                      Movimientos
                    </Button>
                  )}
                  {puedeEditar && (
                    <MenuAcciones
                      etiqueta={`Acciones de ${p.nombre}`}
                      acciones={[
                        { etiqueta: 'Movimientos', icono: <History size={15} />, onClick: () => abrir({ tipo: 'kardex', p }) },
                        { etiqueta: 'Ajuste de stock', icono: <SlidersHorizontal size={15} />, onClick: () => abrir({ tipo: 'ajuste', p }) },
                        { etiqueta: 'Editar', icono: <Pencil size={15} />, onClick: () => abrir({ tipo: 'editar', p }) },
                        {
                          etiqueta: 'Activar',
                          icono: <Power size={15} />,
                          oculto: p.activo,
                          disabled: guardando,
                          onClick: () => cambiarEstado(p, true),
                        },
                        {
                          etiqueta: 'Desactivar',
                          icono: <Power size={15} />,
                          peligro: true,
                          oculto: !p.activo,
                          onClick: () => setADesactivar(p),
                        },
                      ]}
                    />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>
    );

  const tituloDialogo =
    dialogo?.tipo === 'crear'
      ? 'Crear producto'
      : dialogo?.tipo === 'editar'
        ? `Editar ${dialogo.p.nombre}`
        : dialogo?.tipo === 'entrada'
          ? `Entrada de stock · ${dialogo.p.nombre}`
          : dialogo?.tipo === 'ajuste'
            ? `Ajuste de stock · ${dialogo.p.nombre}`
            : dialogo?.tipo === 'kardex'
              ? `Movimientos · ${dialogo.p.nombre}`
              : '';

  const resultadoAjuste =
    dialogo?.tipo === 'ajuste' && esEntero(cantidad)
      ? dialogo.p.stock + Number(cantidad) * (sentidoAjuste === 'restar' ? -1 : 1)
      : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Productos</h1>
          <p className="page-subtitle">Catálogo de lo que se vende en recepción, con precio y stock</p>
        </div>
        {puedeCrear && (
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => abrir({ tipo: 'crear' })}>
            Crear producto
          </Button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <SearchInput
          placeholder="Buscar por nombre"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          aria-label="Buscar producto"
        />
        <select
          className="form-select"
          style={{ maxWidth: 200 }}
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value as '' | 'activo' | 'inactivo');
            setPagina(1);
          }}
          aria-label="Filtrar por estado"
        >
          <option value="">Todos los estados</option>
          <option value="activo">Activos</option>
          <option value="inactivo">Desactivados</option>
        </select>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.9rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={bajoStock}
            onChange={(e) => {
              setBajoStock(e.target.checked);
              setPagina(1);
            }}
          />
          Solo stock bajo ({STOCK_CRITICO} o menos)
        </label>
        {hayFiltros && (
          <Button variant="ghost" size="sm" onClick={limpiarFiltros}>
            Limpiar filtros
          </Button>
        )}
      </div>

      {contenido}

      {/* Crear / editar / entrada / ajuste */}
      <Drawer
        isOpen={!!dialogo && dialogo.tipo !== 'kardex'}
        onClose={cerrar}
        title={tituloDialogo}
        footer={
          <>
            <Button variant="outline" onClick={cerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button
              variant={dialogo?.tipo === 'ajuste' ? 'danger' : 'primary'}
              type="submit"
              form="form-producto"
              isLoading={guardando}
            >
              {dialogo?.tipo === 'crear'
                ? 'Crear producto'
                : dialogo?.tipo === 'editar'
                  ? 'Guardar cambios'
                  : dialogo?.tipo === 'entrada'
                    ? 'Registrar entrada'
                    : 'Registrar ajuste'}
            </Button>
          </>
        }
      >
        <form id="form-producto" onSubmit={guardar} noValidate>
          {errorGuardar &&
            (errorGuardar.tipo === 'conflicto' && dialogo?.tipo === 'editar' ? (
              <div style={{ marginBottom: 12 }}>
                <Conflicto
                  onRecargar={() => {
                    setDialogo(null);
                    cargar();
                  }}
                />
              </div>
            ) : (
              <MensajeFijo tono="error" style={{ marginBottom: 12 }}>
                {errorGuardar.message}
              </MensajeFijo>
            ))}

          {(dialogo?.tipo === 'crear' || dialogo?.tipo === 'editar') && (
            <>
              <Input
                label="Nombre"
                value={nombre}
                maxLength={150}
                onChange={(e) => setNombre(e.target.value)}
                onBlur={() => tocar('nombre')}
                error={err('nombre')}
                disabled={guardando}
              />
              <Input
                label="Precio de venta (COP)"
                type="number"
                min={0}
                step={100}
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                onBlur={() => tocar('precio')}
                error={err('precio')}
                disabled={guardando}
              />
              {dialogo.tipo === 'crear' ? (
                <Input
                  label="Stock inicial"
                  type="number"
                  min={0}
                  step={1}
                  value={stockInicial}
                  onChange={(e) => setStockInicial(e.target.value)}
                  onBlur={() => tocar('stock_inicial')}
                  error={err('stock_inicial')}
                  disabled={guardando}
                />
              ) : (
                <>
                  <Input label="Stock actual" value={String(dialogo.p.stock)} disabled readOnly />
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: -8 }}>
                    El stock solo cambia con entradas, ajustes y ventas, para que el kardex cuadre. Las ventas ya
                    hechas conservan su precio.
                  </p>
                </>
              )}
            </>
          )}

          {dialogo?.tipo === 'entrada' && (
            <>
              <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>Stock actual: {dialogo.p.stock}</p>
              <Input
                label="Cantidad que llega"
                type="number"
                min={1}
                step={1}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                onBlur={() => tocar('cantidad')}
                error={err('cantidad')}
                disabled={guardando}
              />
              <Input
                label="Referencia (opcional)"
                placeholder="p. ej. Factura proveedor 1234"
                value={motivo}
                maxLength={255}
                onChange={(e) => setMotivo(e.target.value)}
                error={err('motivo')}
                disabled={guardando}
              />
            </>
          )}

          {dialogo?.tipo === 'ajuste' && (
            <>
              <MensajeFijo tono="advertencia" style={{ marginBottom: 12 }}>
                El ajuste corrige el stock por conteo físico, merma o pérdida. Queda en el kardex y en la auditoría con
                tu nombre y el motivo.
              </MensajeFijo>
              <Select
                label="Tipo de ajuste"
                value={sentidoAjuste}
                onChange={(e) => setSentidoAjuste(e.target.value as 'sumar' | 'restar')}
                options={[
                  { value: 'restar', label: 'Restar (falta, merma o pérdida)' },
                  { value: 'sumar', label: 'Sumar (sobra en el conteo)' },
                ]}
                disabled={guardando}
              />
              <Input
                label="Cantidad"
                type="number"
                min={1}
                step={1}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                onBlur={() => tocar('cantidad')}
                error={err('cantidad')}
                disabled={guardando}
              />
              <Textarea
                label="Motivo"
                value={motivo}
                maxLength={255}
                onChange={(e) => setMotivo(e.target.value)}
                onBlur={() => tocar('motivo')}
                error={err('motivo')}
                disabled={guardando}
              />
              {resultadoAjuste !== null && (
                <p style={{ fontSize: '0.9rem', margin: 0 }}>
                  Stock: {dialogo.p.stock} → <strong>{resultadoAjuste}</strong>
                </p>
              )}
            </>
          )}
        </form>
      </Drawer>

      {/* Kardex del producto */}
      <Drawer isOpen={dialogo?.tipo === 'kardex'} onClose={() => setDialogo(null)} title={tituloDialogo} size="lg">
        {dialogo?.tipo === 'kardex' && <KardexProducto producto={dialogo.p} />}
      </Drawer>

      <ConfirmDialog
        isOpen={aDesactivar !== null}
        onClose={() => setADesactivar(null)}
        onConfirm={() => aDesactivar && cambiarEstado(aDesactivar, false)}
        title="Desactivar producto"
        message={`"${aDesactivar?.nombre ?? ''}" dejará de aparecer en el punto de venta. Su historial y stock se conservan; puedes activarlo de nuevo.`}
        confirmText="Desactivar"
        isDestructive
        isLoading={guardando}
      />
    </div>
  );
};
