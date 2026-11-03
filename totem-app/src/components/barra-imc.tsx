import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

// Barrita del IMC (sin el número: ese va en el campo IMC, al lado del peso). Solo una barra
// que se llena y cambia de color según el estado, con la categoría al lado.
// Clasificación y colores según la tabla del ISSSTE (6 categorías).

type Categoria = { max: number; etiqueta: string; color: string };

const CATEGORIAS: Categoria[] = [
  { max: 18.5, etiqueta: 'Peso bajo', color: '#e8883a' },
  { max: 25, etiqueta: 'Peso normal', color: '#29abd4' },
  { max: 30, etiqueta: 'Sobrepeso', color: '#9c4e96' },
  { max: 35, etiqueta: 'Obesidad I', color: '#e0282e' },
  { max: 40, etiqueta: 'Obesidad II', color: '#3fa535' },
  { max: Infinity, etiqueta: 'Obesidad III', color: '#f0962d' },
];

function categoriaDe(imc: number): Categoria {
  let i = 0;
  while (i < CATEGORIAS.length - 1 && imc >= CATEGORIAS[i].max) i++;
  return CATEGORIAS[i];
}

// Llenado de la barra en una escala visual 15–45.
const llenado = (imc: number) => Math.min(100, Math.max(0, ((imc - 15) / 30) * 100));

export default function BarraIMC({ imc }: { imc: number | null }) {
  if (imc == null || !Number.isFinite(imc)) {
    return <Text style={estilos.sinDato}>Pésate para calcular tu IMC.</Text>;
  }
  const cat = categoriaDe(imc);
  const pos = llenado(imc);
  return (
    <View style={estilos.fila} accessibilityLabel={`IMC: ${cat.etiqueta}`}>
      <View style={estilos.track}>
        <View style={{ flex: Math.max(0.001, pos), backgroundColor: cat.color, height: '100%' }} />
        <View style={{ flex: Math.max(0.001, 100 - pos) }} />
      </View>
      <Text style={[estilos.cond, { color: cat.color }]}>{cat.etiqueta}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  track: { flex: 1, flexDirection: 'row', height: 6, borderRadius: 999, backgroundColor: '#e2e8f0', overflow: 'hidden', marginRight: 8 },
  cond: { fontSize: 12, fontWeight: 'bold' },
  sinDato: { fontSize: 12, color: '#64748b', marginTop: 8 },
});
