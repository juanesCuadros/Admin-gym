import React, { useState } from 'react';
import { Package, Plus, AlertCircle, ShoppingCart } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Table } from '../../components/ui/Table';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { useToast } from '../../contexts/ToastContext';

interface ProductoItem {
  id: string;
  nombre: string;
  categoria: string;
  precio: number;
  stock: number;
  stock_minimo: number;
  activo: boolean;
}

export const InventarioPage: React.FC = () => {
  const { showToast } = useToast();

  const [productos, setProductos] = useState<ProductoItem[]>([
    { id: '1', nombre: 'Bebida Energizante 500ml', categoria: 'Bebidas', precio: 6000, stock: 42, stock_minimo: 10, activo: true },
    { id: '2', nombre: 'Agua Mineral 600ml', categoria: 'Bebidas', precio: 3000, stock: 85, stock_minimo: 20, activo: true },
    { id: '3', nombre: 'Proteína Whey 2lb Vainilla', categoria: 'Suplementos', precio: 140000, stock: 4, stock_minimo: 5, activo: true },
    { id: '4', nombre: 'Creatina Monohidratada 300g', categoria: 'Suplementos', precio: 95000, stock: 12, stock_minimo: 6, activo: true },
    { id: '5', nombre: 'Toalla Microfibra GymOS', categoria: 'Accesorios', precio: 25000, stock: 18, stock_minimo: 8, activo: true },
    { id: '6', nombre: 'Shaker Mezclador 700ml', categoria: 'Accesorios', precio: 22000, stock: 2, stock_minimo: 5, activo: true },
  ]);

  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    nombre: '',
    categoria: 'Bebidas',
    precio: 5000,
    stock: 20,
    stock_minimo: 5,
  });

  const handleCrear = (e: React.FormEvent) => {
    e.preventDefault();
    const nuevo: ProductoItem = {
      id: Math.random().toString(36).substring(2, 9),
      ...formData,
      activo: true,
    };
    setProductos((prev) => [nuevo, ...prev]);
    setShowModal(false);
    showToast('success', 'Producto Registrado', `${nuevo.nombre} agregado al inventario`);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventario y Stock de Productos</h1>
          <p className="page-subtitle">
            Control de existencias para venta en mostrador (Bebidas, suplementos y accesorios)
          </p>
        </div>

        <Button
          variant="primary"
          leftIcon={<Plus size={16} />}
          onClick={() => setShowModal(true)}
        >
          Nuevo Producto
        </Button>
      </div>

      <Card>
        <Table<ProductoItem>
          columns={[
            {
              header: 'Producto',
              render: (p) => (
                <div>
                  <div style={{ fontWeight: 700 }}>{p.nombre}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.categoria}</div>
                </div>
              ),
            },
            {
              header: 'Precio de Venta',
              render: (p) => `$${p.precio.toLocaleString()}`,
            },
            {
              header: 'Stock Actual',
              render: (p) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>{p.stock} unid.</span>
                  {p.stock <= p.stock_minimo && (
                    <Badge variant="danger" dot>
                      Bajo Stock
                    </Badge>
                  )}
                </div>
              ),
            },
            {
              header: 'Stock Mínimo',
              accessor: (p) => `${p.stock_minimo} unid.`,
            },
            {
              header: 'Estado',
              render: (p) => (
                <Badge variant={p.activo ? 'success' : 'neutral'}>
                  {p.activo ? 'Disponible' : 'Agotado'}
                </Badge>
              ),
            },
          ]}
          data={productos}
          keyExtractor={(p) => p.id}
        />
      </Card>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Registrar Producto en Inventario"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleCrear}>
              Guardar Producto
            </Button>
          </>
        }
      >
        <form onSubmit={handleCrear}>
          <Input
            label="Nombre del Producto *"
            placeholder="Ej. Barra de Proteína 60g"
            value={formData.nombre}
            onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="Categoría"
              options={[
                { value: 'Bebidas', label: 'Bebidas' },
                { value: 'Suplementos', label: 'Suplementos' },
                { value: 'Snacks', label: 'Snacks' },
                { value: 'Accesorios', label: 'Accesorios' },
              ]}
              value={formData.categoria}
              onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
            />
            <Input
              label="Precio de Venta ($ COP) *"
              type="number"
              value={formData.precio}
              onChange={(e) => setFormData({ ...formData, precio: Number(e.target.value) })}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Stock Inicial *"
              type="number"
              value={formData.stock}
              onChange={(e) => setFormData({ ...formData, stock: Number(e.target.value) })}
              required
            />
            <Input
              label="Alerta de Stock Mínimo *"
              type="number"
              value={formData.stock_minimo}
              onChange={(e) => setFormData({ ...formData, stock_minimo: Number(e.target.value) })}
              required
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};
