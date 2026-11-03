import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { parsearEstatura } from '../sensores';

type Props = {
  /** Estatura ya guardada, en cm. */
  estaturaCm: number | null;
  /** Peso medido por la báscula (kg); el IMC ahora se muestra en el paso de la balanza, no aquí. */
  peso?: string;
  onEstatura: (cm: number | null) => void;
  /** En el modo paso a paso la tarjeta ocupa todo el ancho. */
  anchoCompleto?: boolean;
};

// Estatura escrita a mano (no hay sensor): desbloquea las demás mediciones. El IMC se
// calcula y se muestra en el paso de la balanza (con el peso).
export default function TarjetaEstatura({ estaturaCm, onEstatura, anchoCompleto = false }: Props) {
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

  return (
    <View style={[estilos.tarjeta, anchoCompleto && estilos.anchoCompleto]} accessibilityLabel="Estatura">
      <Text style={estilos.titulo}>Estatura</Text>
      <Text style={estilos.instruccion}>
        Es el primer dato: mide tu estatura de pie y sin zapatos y escríbela en centímetros para desbloquear las demás mediciones.
      </Text>

      <View style={estilos.fila}>
        <View style={estilos.campo}>
          <Text style={estilos.etiqueta}>ESTATURA</Text>
          <Text style={estilos.metrica}>
            {estaturaCm === null ? '--' : estaturaCm} <Text style={estilos.unidad}>cm</Text>
          </Text>
        </View>
      </View>

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
  anchoCompleto: { width: '100%' },
  titulo: { fontSize: 14, fontWeight: 'bold', color: '#1e293b', marginBottom: 8 },
  instruccion: { fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 17 },
  fila: { flexDirection: 'row', flexWrap: 'wrap' },
  campo: { marginRight: 16, marginBottom: 8 },
  etiqueta: { fontSize: 10, fontWeight: 'bold', color: '#94a3b8', letterSpacing: 1 },
  metrica: { fontSize: 22, fontWeight: 'bold', color: '#0f172a' },
  unidad: { fontSize: 12, color: '#94a3b8', fontWeight: 'normal' },
  error: { color: '#dc2626', fontSize: 13, fontWeight: '600', marginVertical: 6 },
  entrada: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 18, minWidth: 100, color: '#0f172a', backgroundColor: '#fff', marginTop: 4 },
  boton: { backgroundColor: '#002c5f', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 24, alignSelf: 'flex-start', marginTop: 8 },
  botonTexto: { color: '#fff', fontWeight: 'bold' },
  botonSecundario: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1' },
  botonSecundarioTexto: { color: '#475569', fontWeight: 'bold' },
});
