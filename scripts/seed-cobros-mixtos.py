#!/usr/bin/env python3
"""Genera los tres cobros con pago mixto para probar el flujo del cajero.

Cada cobro reproduce lo que escribe Cajero/index.html al confirmar:
  - pedidos:        estado, metodo_pago='mixto', pagos_mixtos, fecha_cobro
  - ventas:         total, subtotal_platillos, items
  - ventas_detalle: una fila por platillo, con imagen

Los tres tipos (mesa, delivery, reserva) para ver si alguno rompe algo.
"""
import json
import subprocess
import re
import sys

URL = open('.pguri-url').read().strip()
SUPA = '/data/data/com.termux/files/home/bin/supabase'


def q(sql):
    r = subprocess.run([SUPA, 'db', 'query', '--db-url', URL, sql],
                       capture_output=True, text=True, timeout=120)
    return (r.stdout + r.stderr)


def rows(sql):
    out = q(sql)
    out = re.sub(r',(\s*[}\]])', r'\1', out)
    i = out.index('{')
    j = out.rindex('}') + 1
    return json.loads(out[i:j])['rows']


tasa = float(rows("select tasa_efectiva from config limit 1")[0]['tasa_efectiva'])
print('tasa efectiva:', tasa)

menu = {r['nombre']: r for r in rows(
    "select id, nombre, precio, imagen from menu where disponible = true")}

COBROS = [
    dict(id='TEST-MIX-1', tipo='mesa',     plato='Dragon Roll',       cant=3,
         pagos=[('efectivo_usd', 10.00, '111222'),
                ('pago_movil', 15000.00, '123456'),
                ('punto_venta', 8000.00, '987654')], delivery_usd=0),
    dict(id='TEST-MIX-2', tipo='delivery', plato='Spicy Tuna Roll',   cant=2,
         pagos=[('efectivo_usd', 10.00, '333444'),
                ('pago_movil', 12000.00, '555111'),
                ('punto_venta', 5000.00, '222333')], delivery_usd=1.50),
    dict(id='TEST-MIX-3', tipo='reserva',  plato='Philadelphia Roll', cant=4,
         pagos=[('efectivo_usd', 15.00, '555666'),
                ('pago_movil', 20000.00, '777888'),
                ('punto_venta', 10000.00, '444555')], delivery_usd=0),
]

ESTADO = {'mesa': 'en_cocina', 'delivery': 'en_camino', 'reserva': 'reserva_pendiente'}

for c in COBROS:
    m = menu[c['plato']]
    precio = float(m['precio'])
    n = c['cant']
    subtotal_usd = round(precio * n, 2)
    subtotal_bs = round(subtotal_usd * tasa, 2)
    delivery_bs = round(c['delivery_usd'] * tasa, 2)
    total = round(subtotal_usd + c['delivery_usd'], 2)

    # pagos_mixtos tal como los arma el cajero: monto y montoBs por método
    pagos = []
    for metodo, monto, ref in c['pagos']:
        monto_bs = round(monto * tasa, 2) if metodo == 'efectivo_usd' else round(monto, 2)
        pagos.append({'metodo': metodo, 'monto': monto, 'montoBs': monto_bs,
                      'referencia': ref})

    items = [{'id': m['id'], 'nombre': m['nombre'], 'cantidad': n,
              'precioUnitarioUSD': precio}]

    j_items = json.dumps(items)
    j_pagos = json.dumps(pagos)

    # Un solo statement por tabla para respetar el límite del CLI.
    #
    # Las tres columnas del envío son distintas a propósito:
    #   costo_delivery      -> el pacto en DÓLARES (como se cargó)
    #   costo_delivery_usd  -> el mismo valor, en su columna explícita
    #   costo_delivery_bs   -> la conversión congelada a la tasa del día
    # No duplicar la de Bs en las dos primeras: el día que se audite el envío
    # en divisa no habría de dónde leerlo.
    sql_pedido = f"""
INSERT INTO pedidos (id, tipo, estado, total, fecha, fecha_cobro, cliente_nombre, items,
    metodo_pago, pagos_mixtos, cajero, costo_delivery, costo_delivery_usd,
    costo_delivery_bs, tasa_aplicada)
VALUES ('{c['id']}', '{c['tipo']}', '{ESTADO[c['tipo']]}', {total}, NOW(), NOW(),
    'Prueba Mixto {c['tipo']}', '{j_items}'::jsonb, 'mixto', '{j_pagos}'::jsonb,
    'Cajero Test', {c['delivery_usd']}, {c['delivery_usd']}, {delivery_bs}, {tasa})
ON CONFLICT (id) DO NOTHING
"""
    print(f"\n--- {c['id']} ({c['tipo']}) total USD {total} ---")
    print(q(sql_pedido).strip()[:300])

    sql_venta = f"""
INSERT INTO ventas (pedido_id, total, subtotal_platillos, items, metodo_pago, tipo, fecha)
VALUES ('{c['id']}', {total}, {subtotal_bs}, {n}, 'mixto', '{c['tipo']}', NOW())
"""
    print(q(sql_venta).strip()[:200])

    sql_det = f"""
INSERT INTO ventas_detalle (pedido_id, platillo_id, platillo_nombre, imagen, cantidad,
    precio_unitario_usd, precio_unitario_bs, subtotal_usd, subtotal_bs, fecha)
VALUES ('{c['id']}', '{m['id']}', '{m['nombre']}', '{m['imagen']}', {n},
    {precio}, {round(precio * tasa, 2)}, {subtotal_usd}, {subtotal_bs}, NOW())
"""
    print(q(sql_det).strip()[:200])

print('\nlisto')
