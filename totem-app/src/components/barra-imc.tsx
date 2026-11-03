import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

// IMC compacto para tablet: una línea de texto pequeña con el estado (en color) y,
// debajo, una línea fina del mismo color. Verde = normopeso … rojo = obesidad mórbida.

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
    return <Text style={estilos.sinDato}>Pésate para calcular tu IMC.</Text>;
  }
  const cat = categoriaDe(imc);
  return (
    <View style={estilos.contenedor} accessibilityLabel={`IMC ${imc.toFixed(1)}, ${cat.etiqueta}`}>
      <Text style={[estilos.texto, { color: cat.color }]}>IMC {imc.toFixed(1)} · {cat.etiqueta}</Text>
      <View style={[estilos.linea, { backgroundColor: cat.color }]} />
    </View>
  );
}

const estilos = StyleSheet.create({
  contenedor: { marginTop: 8 },
  sinDato: { fontSize: 12, color: '#64748b', marginTop: 8 },
  texto: { fontSize: 13, fontWeight: 'bold', marginBottom: 5 },
  linea: { height: 6, borderRadius: 999 },
});
