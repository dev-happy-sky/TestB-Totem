import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

// Pantalla de bienvenida del tótem (modo kiosco): espera hasta que alguien toca "Comenzar".
// Muestra consejos de salud, el horario del gimnasio y accesos a Deporte Duoc.
// Edita HORARIO con el horario real del gimnasio.

const HORARIO = [
  { dia: 'Lunes a viernes', hora: '07:00 – 22:00' },
  { dia: 'Sábado', hora: '09:00 – 14:00' },
  { dia: 'Domingo y festivos', hora: 'Cerrado' },
];

const CONSEJOS = [
  { icono: '💧', texto: 'Hidrátate antes, durante y después de entrenar.' },
  { icono: '🤸', texto: 'Haz 5–10 min de calentamiento para evitar lesiones.' },
  { icono: '❤️', texto: 'Si sientes mareo o dolor en el pecho, detente y avisa al profesor.' },
];

const DUOC_DEPORTES = 'https://www.duoc.cl/vida-estudiantil/deportes/';
// Reserva de hora del Programa de Bienestar Físico (Microsoft Bookings).
const AGENDA_BIENESTAR = 'https://bookings.cloud.microsoft/book/ProgramadeBienestarFsico@duoc.cl/s/u8FdDnq-WUSnwxXqIk3Jmg2?ismsaljsauthenabled&msdynmkt_trackingcontext=8506e5d3-2cba-4b26-8a0d-e94ba2560100#msdynmkt_trackingcontext=b32314c3-6de1-440e-a994-456776720300';

export default function BienvenidaTotem({ onComenzar }: { onComenzar: () => void }) {
  const abrirDeportes = () => { WebBrowser.openBrowserAsync(DUOC_DEPORTES).catch(() => {}); };
  const abrirAgenda = () => { WebBrowser.openBrowserAsync(AGENDA_BIENESTAR).catch(() => {}); };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.brandRow}>
          <View style={styles.logo}><Text style={styles.logoText}>T</Text></View>
          <Text style={styles.brand}>TÓTEM<Text style={styles.brandLight}> FIT</Text></Text>
        </View>

        <Text style={styles.hola}>Bienvenido/a 👋</Text>
        <Text style={styles.sub}>Evalúa tu aptitud física en minutos. Toca “Comenzar” cuando estés listo/a.</Text>

        <TouchableOpacity style={styles.cta} onPress={onComenzar} accessibilityRole="button" accessibilityLabel="Comenzar evaluación">
          <Text style={styles.ctaText}>Comenzar</Text>
        </TouchableOpacity>

        <Text style={styles.seccion}>Consejos de salud</Text>
        <View style={styles.tips}>
          {CONSEJOS.map((c, i) => (
            <View key={i} style={styles.tip}>
              <Text style={styles.tipIcon}>{c.icono}</Text>
              <Text style={styles.tipText}>{c.texto}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.seccion}>Horario del gimnasio</Text>
        <View style={styles.card}>
          {HORARIO.map((h, i) => (
            <View key={i} style={[styles.horaRow, i < HORARIO.length - 1 && styles.horaBorde]}>
              <Text style={styles.horaDia}>{h.dia}</Text>
              <Text style={styles.horaVal}>{h.hora}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.seccion}>Deporte Duoc</Text>
        <TouchableOpacity style={styles.duoc} onPress={abrirDeportes} accessibilityRole="button" accessibilityLabel="Abrir Deporte Duoc">
          <View style={styles.duocIcon}><Text style={styles.duocIconText}>↗</Text></View>
          <View style={styles.duocTextWrap}>
            <Text style={styles.duocTitle}>Selecciones, talleres y actividad física</Text>
            <Text style={styles.duocDesc}>Descubre las actividades deportivas de Duoc UC</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.seccion}>Bienestar físico</Text>
        <TouchableOpacity style={styles.duoc} onPress={abrirAgenda} accessibilityRole="button" accessibilityLabel="Agenda tu hora">
          <View style={styles.agendaIcon}><Text style={styles.agendaIconText}>📅</Text></View>
          <View style={styles.duocTextWrap}>
            <Text style={styles.duocTitle}>Agenda tu hora</Text>
            <Text style={styles.duocDesc}>Programa de Bienestar Físico · Duoc UC</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const DUOC = '#002c5f';
const ORO = '#ffd100';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 28, paddingTop: 48, maxWidth: 680, width: '100%', alignSelf: 'center' },

  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  logo: { width: 40, height: 40, borderRadius: 11, backgroundColor: DUOC, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  logoText: { color: ORO, fontWeight: '900', fontSize: 22 },
  brand: { fontSize: 22, fontWeight: '900', color: DUOC, letterSpacing: 0.5 },
  brandLight: { fontWeight: '400', color: '#64748b' },

  hola: { fontSize: 34, fontWeight: '900', color: DUOC, marginBottom: 8 },
  sub: { fontSize: 16, color: '#64748b', lineHeight: 24, marginBottom: 24 },

  cta: { backgroundColor: DUOC, paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginBottom: 36 },
  ctaText: { color: '#fff', fontWeight: 'bold', fontSize: 20, letterSpacing: 0.5 },

  seccion: { fontSize: 11, fontWeight: 'bold', color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },

  tips: { marginBottom: 28, gap: 10 },
  tip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', padding: 14 },
  tipIcon: { fontSize: 22, marginRight: 12 },
  tipText: { flex: 1, fontSize: 15, color: '#334155', lineHeight: 21 },

  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 16, marginBottom: 28 },
  horaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  horaBorde: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  horaDia: { fontSize: 15, color: '#475569' },
  horaVal: { fontSize: 15, fontWeight: '700', color: DUOC },

  duoc: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', padding: 16, marginBottom: 12 },
  duocIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: ORO, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  duocIconText: { color: DUOC, fontSize: 22, fontWeight: '900' },
  agendaIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#eef3fb', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  agendaIconText: { fontSize: 22 },
  duocTextWrap: { flex: 1 },
  duocTitle: { fontSize: 16, fontWeight: 'bold', color: DUOC },
  duocDesc: { fontSize: 13, color: '#64748b', marginTop: 2 },
});
