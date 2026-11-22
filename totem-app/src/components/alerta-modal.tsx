import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View, type AlertButton } from 'react-native';

import { registrarAlertaHost, type Alerta } from '../utils/dialogo';

/**
 * Cuadro de alerta propio para la versión web (la tablet del tótem). Reemplaza al `window.confirm`/`window.alert` del navegador,
 * que se ve feo y fuera de estilo. Se monta una sola vez en la raíz: `mostrarAlerta` le va mandando las alertas y se muestran de a
 * una, a pantalla completa, con el mismo estilo que el resto de la app.
 */
export default function AlertaHost() {
  const [cola, setCola] = useState<Alerta[]>([]);

  useEffect(() => {
    registrarAlertaHost((alerta) => setCola((previa) => [...previa, alerta]));
    return () => registrarAlertaHost(null);
  }, []);

  const actual = cola[0];
  if (!actual) return null;

  // Al cerrar, primero corre la acción del botón pulsado y luego saca esta alerta de la cola (si hay otra, aparece enseguida).
  const cerrar = (boton?: AlertButton) => {
    boton?.onPress?.();
    setCola((previa) => previa.slice(1));
  };

  const botones: AlertButton[] = actual.botones && actual.botones.length > 0 ? actual.botones : [{ text: 'Aceptar' }];
  // El botón "cancelar" (o el primero, si ninguno lo es) es el que responde al botón físico Atrás.
  const alCerrarConAtras = () => cerrar(botones.find((b) => b.style === 'cancel') ?? botones[0]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={alCerrarConAtras}>
      <View style={estilos.fondo} accessibilityLabel={`Alerta: ${actual.titulo}`} accessibilityLiveRegion="assertive">
        <View style={estilos.cuadro}>
          <Text style={estilos.titulo} accessibilityRole="header">{actual.titulo}</Text>
          {!!actual.mensaje && <Text style={estilos.mensaje}>{actual.mensaje}</Text>}
          <View style={estilos.fila}>
            {botones.map((boton, i) => {
              const esCancelar = boton.style === 'cancel';
              const esDestructivo = boton.style === 'destructive';
              return (
                <TouchableOpacity
                  key={`${boton.text ?? ''}-${i}`}
                  style={[estilos.boton, esCancelar && estilos.botonCancelar, esDestructivo && estilos.botonDestructivo]}
                  onPress={() => cerrar(boton)} accessibilityRole="button" accessibilityLabel={boton.text ?? 'Aceptar'}>
                  <Text style={[estilos.botonTexto, esCancelar && estilos.botonCancelarTexto]}>{boton.text ?? 'Aceptar'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(15,23,42,0.78)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  cuadro: { width: '100%', maxWidth: 480, backgroundColor: '#fff', borderRadius: 24, paddingVertical: 36, paddingHorizontal: 32 },
  titulo: { fontSize: 24, fontWeight: 'bold', color: '#0f172a', textAlign: 'center' },
  mensaje: { fontSize: 16, color: '#475569', textAlign: 'center', lineHeight: 24, marginTop: 16 },
  fila: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 28 },
  boton: { backgroundColor: '#002c5f', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 24, marginHorizontal: 6, marginTop: 8, minWidth: 130, alignItems: 'center' },
  botonTexto: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  botonCancelar: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1' },
  botonCancelarTexto: { color: '#475569' },
  botonDestructivo: { backgroundColor: '#dc2626' },
});
