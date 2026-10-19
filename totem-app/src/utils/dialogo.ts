import { Alert, Platform, type AlertButton } from 'react-native';

/**
 * Aviso que funciona también en la versión web. En React Native Web `Alert.alert` es una función vacía: en el quiosco y en el
 * navegador de la tablet los avisos (datos inválidos, posible duplicado, errores del servidor...) no aparecían y la pantalla parecía
 * trabada. En el teléfono y en la tablet instalada se sigue usando `Alert.alert`.
 *
 * En web: sin botones o con uno solo se usa `window.alert`; con dos o más, `window.confirm`: Aceptar ejecuta el botón de acción
 * (el primero que no es "cancel") y Cancelar el de cancelar.
 */
export function mostrarAlerta(titulo: string, mensaje?: string, botones?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    // Se pasa exactamente lo recibido: sin argumentos sobrantes.
    if (botones) Alert.alert(titulo, mensaje, botones);
    else if (mensaje !== undefined) Alert.alert(titulo, mensaje);
    else Alert.alert(titulo);
    return;
  }
  const ventana = (globalThis as { window?: { alert?: (t: string) => void; confirm?: (t: string) => boolean } }).window;
  const texto = mensaje ? `${titulo}\n\n${mensaje}` : titulo;
  const lista = botones ?? [];

  if (lista.length < 2) {
    ventana?.alert?.(texto);
    lista[0]?.onPress?.();
    return;
  }
  const cancelar = lista.find((b) => b.style === 'cancel') ?? lista[0];
  const aceptar = lista.find((b) => b !== cancelar) ?? lista[0];
  const acepto = ventana?.confirm?.(`${texto}\n\nAceptar: ${aceptar.text}\nCancelar: ${cancelar.text}`) ?? false;
  (acepto ? aceptar : cancelar).onPress?.();
}
