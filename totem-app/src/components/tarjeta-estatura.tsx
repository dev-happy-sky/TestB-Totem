import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { calcularIMC, parsearEstatura } from '../sensores';

type Props = {
  /** Estatura ya guardada, en cm. */
  estaturaCm: number | null;
  /** Peso medido por la báscula (kg), si ya hay. */
  peso?: string;
  onEstatura: (cm: number | null) => void;
};

const COLOR_NORMAL = '#0f172a';
const COLOR_ALERTA = '#ef4444';

// Estatura escrita a mano (no hay sensor): con ella y el peso de la báscula se calcula el IMC.
export default function TarjetaEstatura({ estaturaCm, peso, onEstatura }: Props) {
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');

  const guardar = () => {
    const resultado = parsearEstatura(texto);
    if ('error' in resultado) {
      setError(resultado.error);
      return;
    }
    setError('');
    setTexto('');
    onEstatura(resultado.cm);
  };

  const cambiar = () => {
    setTexto(String(estaturaCm ?? ''));
    setError('');
    onEstatura(null);
  };

  const imc = estaturaCm !== null && peso ? calcularIMC(peso, estaturaCm) : null;
  const imcAnormal = imc !== null && 'imc' in imc && (Number(imc.imc) >= 25 || Number(imc.imc) < 18.5);

  return (
    <View style={estilos.tarjeta} accessibilityLabel="Estatura e IMC">
      <Text style={estilos.titulo}>Estatura e IMC</Text>
      <Text style={estilos.instruccion}>
        Es el primer dato: mide tu estatura de pie y sin zapatos y escríbela en centímetros para desbloquear las demás mediciones.
        El IMC se calcula con el peso de la báscula.
      </Text>

      <View style={estilos.fila}>
        <View style={estilos.campo}>
          <Text style={estilos.etiqueta}>ESTATURA</Text>
          <Text style={estilos.metrica}>
            {estaturaCm === null ? '--' : estaturaCm} <Text style={estilos.unidad}>cm</Text>
          </Text>
        </View>
        <View style={estilos.campo}>
          <Text style={estilos.etiqueta}>IMC</Text>
          <Text style={[estilos.metrica, { color: imcAnormal ? COLOR_ALERTA : COLOR_NORMAL }]}>
            {imc !== null && 'imc' in imc ? imc.imc : '--'} <Text style={estilos.unidad}>kg/m²</Text>
          </Text>
        </View>
      </View>

      {estaturaCm !== null && !peso && <Text style={estilos.aviso}>Falta el peso: mídelo en la báscula para calcular el IMC.</Text>}
      {imc !== null && 'error' in imc && <Text style={estilos.error} accessibilityRole="alert">{imc.error}</Text>}

      {estaturaCm === null ? (
        <View>
          <Text style={estilos.etiqueta}>ESTATURA (cm)</Text>
          <TextInput
            style={estilos.entrada} keyboardType="decimal-pad" maxLength={5} value={texto} onChangeText={(t) => { setTexto(t); setError(''); }}
            accessibilityLabel="Estatura manual" placeholder="172"
          />
          {!!error && <Text style={estilos.error} accessibilityRole="alert">{error}</Text>}
          <TouchableOpacity style={estilos.boton} onPress={guardar} accessibilityRole="button" accessibilityLabel="Guardar estatura">
            <Text style={estilos.botonTexto}>Guardar estatura</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={[estilos.boton, estilos.botonSecundario]} onPress={cambiar} accessibilityRole="button" accessibilityLabel="Cambiar estatura">
          <Text style={estilos.botonSecundarioTexto}>Cambiar estatura</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  tarjeta: { width: '48%', backgroundColor: '#fff', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 15 },
  titulo: { fontSize: 14, fontWeight: 'bold', color: '#1e293b', marginBottom: 8 },
  instruccion: { fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 17 },
  fila: { flexDirection: 'row', flexWrap: 'wrap' },
  campo: { marginRight: 16, marginBottom: 8 },
  etiqueta: { fontSize: 10, fontWeight: 'bold', color: '#94a3b8', letterSpacing: 1 },
  metrica: { fontSize: 22, fontWeight: 'bold', color: COLOR_NORMAL },
  unidad: { fontSize: 12, color: '#94a3b8', fontWeight: 'normal' },
  aviso: { color: '#64748b', fontSize: 13, marginVertical: 6 },
  error: { color: '#dc2626', fontSize: 13, fontWeight: '600', marginVertical: 6 },
  entrada: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 18, minWidth: 100, color: '#0f172a', backgroundColor: '#fff', marginTop: 4 },
  boton: { backgroundColor: '#ea580c', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 24, alignSelf: 'flex-start', marginTop: 8 },
  botonTexto: { color: '#fff', fontWeight: 'bold' },
  botonSecundario: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1' },
  botonSecundarioTexto: { color: '#475569', fontWeight: 'bold' },
});
