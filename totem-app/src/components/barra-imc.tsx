import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

// Barra de IMC tipo semáforo (verde → roja) con un marcador en el valor del alumno.
// Categorías OMS: < 18,5 insuficiente · 18,5–24,9 normopeso · 25–29,9 sobrepeso ·
// 30–34,9 obesidad · ≥ 35 obesidad mórbida.

type Categoria = { max: number; etiqueta: string; rango: string; color: string };

const CATEGORIAS: Categoria[] = [
  { max: 18.5, etiqueta: 'Peso insuficiente', rango: '< 18,5', color: '#93a9bf' },
  { max: 25, etiqueta: 'Normopeso', rango: '18,5–24,9', color: '#73b84a' },
  { max: 30, etiqueta: 'Sobrepeso', rango: '25–29,9', color: '#f1c40f' },
  { max: 35, etiqueta: 'Obesidad', rango: '30–34,9', color: '#e8883a' },
  { max: Infinity, etiqueta: 'Obesidad mórbida', rango: '35 +', color: '#dc5149' },
];

// Límites para posicionar el marcador (escala visual 15–40, segmentos de igual ancho).
const LIMITES = [15, 18.5, 25, 30, 35, 40];

function indiceDe(imc: number): number {
  let i = 0;
  while (i < CATEGORIAS.length - 1 && imc >= CATEGORIAS[i].max) i++;
  return i;
}

function posicion(imc: number): number {
  const seg = Math.min(indiceDe(imc), LIMITES.length - 2);
  const lo = LIMITES[seg];
  const hi = LIMITES[seg + 1];
  const dentro = Math.min(1, Math.max(0, (imc - lo) / (hi - lo)));
  return ((seg + dentro) / (LIMITES.length - 1)) * 100;
}

export default function BarraIMC({ imc }: { imc: number | null }) {
  if (imc == null || !Number.isFinite(imc)) {
    return (
      <View style={estilos.contenedor}>
        <Text style={estilos.titulo}>ÍNDICE DE MASA CORPORAL (IMC)</Text>
        <Text style={estilos.sinDato}>Pésate para calcular tu IMC.</Text>
      </View>
    );
  }

  const cat = CATEGORIAS[indiceDe(imc)];
  const pos = posicion(imc);

  return (
    <View style={estilos.contenedor} accessibilityLabel={`IMC ${imc.toFixed(1)}, ${cat.etiqueta}`}>
      <Text style={estilos.titulo}>ÍNDICE DE MASA CORPORAL (IMC)</Text>
      <View style={estilos.valorFila}>
        <Text style={[estilos.valor, { color: cat.color }]}>{imc.toFixed(1)}</Text>
        <Text style={estilos.unidad}>kg/m²</Text>
        <View style={[estilos.chip, { backgroundColor: cat.color }]}>
          <Text style={estilos.chipTexto}>{cat.etiqueta}</Text>
        </View>
      </View>

      {/* Marcador (posicionado con flex para no depender de porcentajes) */}
      <View style={estilos.pista}>
        <View style={{ flex: Math.max(0.001, pos) }} />
        <View style={estilos.marcadorTriangulo} />
        <View style={{ flex: Math.max(0.001, 100 - pos) }} />
      </View>

      {/* Barra de segmentos */}
      <View style={estilos.barra}>
        {CATEGORIAS.map((c, i) => (
          <View
            key={c.etiqueta}
            style={[
              estilos.segmento,
              { backgroundColor: c.color },
              i === 0 && estilos.segmentoIzq,
              i === CATEGORIAS.length - 1 && estilos.segmentoDer,
            ]}>
            <Text style={estilos.segRango} numberOfLines={1}>{c.rango}</Text>
          </View>
        ))}
      </View>

      {/* Etiquetas bajo la barra */}
      <View style={estilos.barra}>
        {CATEGORIAS.map((c) => (
          <Text key={c.etiqueta} style={estilos.segEtiqueta} numberOfLines={2}>{c.etiqueta}</Text>
        ))}
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { marginTop: 10, marginBottom: 4 },
  titulo: { fontSize: 10, fontWeight: 'bold', color: '#94a3b8', letterSpacing: 1 },
  sinDato: { fontSize: 13, color: '#64748b', marginTop: 6 },
  valorFila: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 10 },
  valor: { fontSize: 30, fontWeight: 'bold' },
  unidad: { fontSize: 12, color: '#94a3b8', marginLeft: 4, marginRight: 10 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipTexto: { color: '#fff', fontSize: 12, fontWeight: 'bold' },

  pista: { flexDirection: 'row', alignItems: 'flex-end', height: 12 },
  marcadorTriangulo: {
    width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 10, marginHorizontal: -7,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#0f172a',
  },

  barra: { flexDirection: 'row', width: '100%' },
  segmento: { flex: 1, height: 26, justifyContent: 'center', alignItems: 'center', marginHorizontal: 1 },
  segmentoIzq: { borderTopLeftRadius: 6, borderBottomLeftRadius: 6, marginLeft: 0 },
  segmentoDer: { borderTopRightRadius: 6, borderBottomRightRadius: 6, marginRight: 0 },
  segRango: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  segEtiqueta: { flex: 1, textAlign: 'center', fontSize: 8.5, color: '#64748b', marginTop: 4, marginHorizontal: 1 },
});
