import { Alert, Platform, type AlertButton } from 'react-native';

/** Una alerta pendiente de mostrar: lo mismo que recibe `mostrarAlerta`. */
export type Alerta = { titulo: string; mensaje?: string; botones?: AlertButton[] };

// En la tablet web montamos nuestro propio cuadro de alerta (AlertaHost) en vez del `window.confirm`/`window.alert` del navegador,
// que se ve feo ("192.168.3.47:8081 dice…"). El host se registra aquí al montarse; mientras no haya ninguno (tests sin host, un
// entorno sin navegador), se usa el `window.alert`/`confirm` de siempre como respaldo.
let suscriptor: ((alerta: Alerta) => void) | null = null;
export function registrarAlertaHost(fn: ((alerta: Alerta) => void) | null): void {
  suscriptor = fn;
}

/** Entrega la alerta al host montado. Devuelve false si no hay ninguno (y entonces se usa el diálogo del navegador de respaldo). */
export function emitirAlerta(alerta: Alerta): boolean {
  if (!suscriptor) return false;
  suscriptor(alerta);
  return true;
}

/**
 * Aviso que funciona también en la versión web. En React Native Web `Alert.alert` es una función vacía: en el quiosco y en el
 * navegador de la tablet los avisos (datos inválidos, posible duplicado, errores del servidor...) no aparecían y la pantalla parecía
 * trabada. En el teléfono y en la tablet instalada se sigue usando `Alert.alert`.
 *
 * En web, si hay un AlertaHost montado, se le manda la alerta para mostrarla con nuestro cuadro. Si no lo hay, de respaldo:
 * sin botones o con uno solo se usa `window.alert`; con dos o más, `window.confirm` (Aceptar ejecuta el botón de acción —el primero
 * que no es "cancel"— y Cancelar el de cancelar).
 */
export function mostrarAlerta(titulo: string, mensaje?: string, botones?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    // Se pasa exactamente lo recibido: sin argumentos sobrantes.
    if (botones) Alert.alert(titulo, mensaje, botones);
    else if (mensaje !== undefined) Alert.alert(titulo, mensaje);
    else Alert.alert(titulo);
    return;
  }
  if (emitirAlerta({ titulo, mensaje, botones })) return;
  // Respaldo sin host: el diálogo nativo del navegador.
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
