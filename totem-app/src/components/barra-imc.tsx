import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

// IMC estilo "barra de confianza": una barrita que se llena y cambia de color según
// el estado, con el valor y la condición al lado. Verde = normopeso … rojo = mórbida.

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

// Posición del valor en una escala visual 15–40 (solo para llenar la barra).
const llenado = (imc: number) => Math.min(100, Math.max(0, ((imc - 15) / 25) * 100));

export default function BarraIMC({ imc }: { imc: number | null }) {
  if (imc == null || !Number.isFinite(imc)) {
    return <Text style={estilos.sinDato}>Pésate para calcular tu IMC.</Text>;
  }
  const cat = categoriaDe(imc);
  const pos = llenado(imc);
  return (
    <View style={estilos.fila} accessibilityLabel={`IMC ${imc.toFixed(1)}, ${cat.etiqueta}`}>
      <Text style={estilos.label}>IMC</Text>
      <View style={estilos.track}>
        <View style={{ flex: Math.max(0.001, pos), backgroundColor: cat.color, height: '100%', borderRadius: 999 }} />
        <View style={{ flex: Math.max(0.001, 100 - pos) }} />
      </View>
      <Text style={[estilos.cond, { color: cat.color }]}>{imc.toFixed(1)} · {cat.etiqueta}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', marginTop: 8, flexWrap: 'wrap' },
  label: { fontSize: 11, fontWeight: 'bold', color: '#64748b', letterSpacing: 1, marginRight: 8 },
  track: { flexDirection: 'row', width: 70, height: 6, borderRadius: 999, backgroundColor: '#e2e8f0', overflow: 'hidden', marginRight: 8 },
  cond: { fontSize: 12, fontWeight: 'bold' },
  sinDato: { fontSize: 12, color: '#64748b', marginTop: 8 },
});
