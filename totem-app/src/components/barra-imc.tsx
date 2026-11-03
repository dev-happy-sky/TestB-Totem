import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

// IMC sutil: el estado (categoría OMS) escrito arriba y UNA línea que cambia de color
// claramente según ese estado (verde = normopeso … rojo = obesidad mórbida).

type Categoria = { max: number; etiqueta: string; color: string };

const CATEGORIAS: Categoria[] = [
  { max: 18.5, etiqueta: 'Peso insuficiente', color: '#60a5fa' },
  { max: 25, etiqueta: 'Normopeso', color: '#16a34a' },
  { max: 30, etiqueta: 'Sobrepeso', color: '#eab308' },
  { max: 35, etiqueta: 'Obesidad', color: '#f97316' },
  { max: Infinity, etiqueta: 'Obesidad mórbida', color: '#dc2626' },
];

function categoriaDe(imc: number): Categoria {
  let i = 0;
  while (i < CATEGORIAS.length - 1 && imc >= CATEGORIAS[i].max) i++;
  return CATEGORIAS[i];
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

  const cat = categoriaDe(imc);

  return (
    <View style={estilos.contenedor} accessibilityLabel={`IMC ${imc.toFixed(1)}, ${cat.etiqueta}`}>
      <Text style={estilos.titulo}>ÍNDICE DE MASA CORPORAL (IMC)</Text>
      <View style={estilos.fila}>
        <Text style={[estilos.estado, { color: cat.color }]}>{cat.etiqueta}</Text>
        <Text style={estilos.valor}>{imc.toFixed(1)}<Text style={estilos.unidad}> kg/m²</Text></Text>
      </View>
      <View style={[estilos.linea, { backgroundColor: cat.color }]} />
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { marginTop: 10, marginBottom: 4 },
  titulo: { fontSize: 10, fontWeight: 'bold', color: '#94a3b8', letterSpacing: 1 },
  sinDato: { fontSize: 13, color: '#64748b', marginTop: 6 },
  fila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6, marginBottom: 8 },
  estado: { fontSize: 18, fontWeight: 'bold' },
  valor: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  unidad: { fontSize: 12, color: '#94a3b8', fontWeight: 'normal' },
  linea: { height: 8, borderRadius: 999 },
});
