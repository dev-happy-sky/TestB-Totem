import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, SafeAreaView, Alert } from 'react-native';
import Slider from '@react-native-community/slider';

export default function App() {
  // --- NAVEGACIÓN ---
  const [pasoActual, setPasoActual] = useState(1);
  const totalPasos = 5;
  const nombresPasos = ['Identificación', 'Mediciones', 'Objetivo', 'Salud', 'Listo'];

  // --- ESTADO PASO 1 ---
  const [formData, setFormData] = useState({
    nombre: 'Cristobal Gutierrez', 
    matricula: 'XXXXXXXXXXX',
    edad: '22',
    carrera: 'Informatica'
  });

  // --- ESTADO PASO 2 ---
  const [mediciones, setMediciones] = useState({
    presionSys: 117, presionDia: 81, fcReposo: 79, fcRecup: 101, peso: '90.3', imc: '27.3', grasa: '18.3', vo2Max: '44.6'
  });

  // --- ESTADO PASO 3 ---
  const [objetivo, setObjetivo] = useState('Fuerza');
  const [experiencia, setExperiencia] = useState('Intermedio');
  const [duracion, setDuracion] = useState(60);

  // --- ESTADO PASO 4 ---
  const [sintomasHoy, setSintomasHoy] = useState(['Medicación permanente']);
  const [condicionesSalud, setCondicionesSalud] = useState(['Hipertensión']);

  // --- FUNCIONES LÓGICAS ---
  const simularMediciones = () => {
    setMediciones({
      presionSys: Math.floor(Math.random() * (140 - 90 + 1)) + 90,
      presionDia: Math.floor(Math.random() * (90 - 60 + 1)) + 60,
      fcReposo: Math.floor(Math.random() * (100 - 60 + 1)) + 60,
      fcRecup: Math.floor(Math.random() * (150 - 100 + 1)) + 100,
      peso: (Math.random() * (110 - 60) + 60).toFixed(1),
      imc: (Math.random() * (32 - 18.5) + 18.5).toFixed(1),
      grasa: (Math.random() * (25 - 10) + 10).toFixed(1),
      vo2Max: (Math.random() * (60 - 30) + 30).toFixed(1)
    });
  };

  const toggleSintoma = (sintoma: string) => {
    setSintomasHoy(prev => prev.includes(sintoma) ? prev.filter(s => s !== sintoma) : [...prev, sintoma]);
  };

  const toggleCondicion = (condicion: string) => {
    setCondicionesSalud(prev => prev.includes(condicion) ? prev.filter(c => c !== condicion) : [...prev, condicion]);
  };

  const avanzar = () => { if (pasoActual < totalPasos) setPasoActual(pasoActual + 1); };
  const retroceder = () => { if (pasoActual > 1) setPasoActual(pasoActual - 1); };

  // Función para finalizar y reiniciar el Tótem
const registrarIngreso = async () => {
    console.log("=== INICIANDO REGISTRO ===");
    const payload = {
      estudiante: formData,
      mediciones: mediciones,
      entrenamiento: { objetivo, experiencia, duracion },
      salud: { sintomas: sintomasHoy, condiciones: condicionesSalud }
    };

    console.log("Payload enviado:", JSON.stringify(payload, null, 2));

    try {
      // Reemplaza por la URL de producción:
      const response = await fetch('https://totem-backend-g6yh.onrender.com/api/evaluaciones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log("Código de estado HTTP recibido:", response.status);
      const data = await response.json();
      console.log("Cuerpo de la respuesta del servidor:", data);

      if (response.ok) {
        Alert.alert("¡Éxito!", "Tus datos han sido enviados al profesor.");
        setPasoActual(1);
      } else {
        Alert.alert("Error del servidor", `Código ${response.status}: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      console.error("Fallo de red en fetch:", error);
      const mensajeError = error instanceof Error ? error.message : "No se pudo comunicar con el servidor central.";
      Alert.alert("Error de conexión", mensajeError);
    }
  };
  // --- FUNCIONES DE RENDERIZADO ---

  const renderPaso1 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepSubtitle}>PASO 1 - REGISTRO</Text>
      <Text style={styles.stepTitle}>Registremos tu ingreso</Text>
      <Text style={styles.stepDescription}>Acerca tu credencial universitaria al lector, o ingresa tus datos manualmente.</Text>
      <TouchableOpacity style={styles.scanCard}><Text style={styles.scanCardTitle}>Escanear credencial</Text><Text style={styles.scanCardDesc}>Autocompleta tus datos y pasa a las mediciones</Text></TouchableOpacity>
      <Text style={styles.dividerText}>O INGRESA MANUALMENTE</Text>
      <View style={styles.inputGroup}><Text style={styles.label}>NOMBRE COMPLETO</Text><TextInput style={styles.input} value={formData.nombre} onChangeText={(t) => setFormData({ ...formData, nombre: t })} /></View>
      <View style={styles.row}>
        <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}><Text style={styles.label}>MATRÍCULA</Text><TextInput style={styles.input} value={formData.matricula} onChangeText={(t) => setFormData({ ...formData, matricula: t })} /></View>
        <View style={[styles.inputGroup, { width: 100 }]}><Text style={styles.label}>EDAD</Text><TextInput style={styles.input} value={formData.edad} onChangeText={(t) => setFormData({ ...formData, edad: t })} keyboardType="numeric" /></View>
      </View>
      <View style={styles.inputGroup}><Text style={styles.label}>CARRERA</Text><TextInput style={styles.input} value={formData.carrera} onChangeText={(t) => setFormData({ ...formData, carrera: t })} /></View>
    </View>
  );

  const renderPaso2 = () => {
    // Función que devuelve rojo si el valor está fuera del rango médico estándar
    const evaluarColor = (tipo: string, valor1: string | number, valor2: string | number = 0) => {
      const v1 = parseFloat(valor1.toString());
      const v2 = parseFloat(valor2.toString());
      let esAnormal = false;

      switch(tipo) {
        case 'presion': // Normal: Sys 90-129 y Dia 60-84
          esAnormal = v1 >= 130 || v1 < 90 || v2 >= 85 || v2 < 60;
          break;
        case 'fc': // Normal: 60 - 100 lpm
          esAnormal = v1 > 100 || v1 < 60;
          break;
        case 'imc': // Normal: 18.5 - 24.9
          esAnormal = v1 >= 25.0 || v1 < 18.5;
          break;
      }
      return esAnormal ? '#ef4444' : '#0f172a'; // Rojo si es anormal, gris oscuro si es normal
    };

    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepSubtitle}>PASO 2 - ESTACIÓN DE SENSORES</Text>
        <Text style={styles.stepTitle}>Tus mediciones de hoy</Text>
        <Text style={styles.stepDescription}>Los sensores del tótem se conectan por Bluetooth. Sigue las indicaciones y presiona medir.</Text>
        
        <View style={styles.grid}>
          {/* Tensiómetro */}
          <View style={styles.sensorCard}>
            <Text style={styles.sensorTitle}>Tensiómetro</Text>
            <Text style={styles.label}>PRESIÓN</Text>
            <Text style={[styles.metric, { color: evaluarColor('presion', mediciones.presionSys, mediciones.presionDia) }]}>
              {mediciones.presionSys}/{mediciones.presionDia} <Text style={styles.unit}>mmHg</Text>
            </Text>
          </View>
          
          {/* Banda de pecho */}
          <View style={styles.sensorCard}>
            <Text style={styles.sensorTitle}>Banda de pecho</Text>
            <View style={styles.row}>
              <View style={{marginRight: 20}}>
                <Text style={styles.label}>FC REPOSO</Text>
                <Text style={[styles.metric, { color: evaluarColor('fc', mediciones.fcReposo) }]}>
                  {mediciones.fcReposo} <Text style={styles.unit}>lpm</Text>
                </Text>
              </View>
              <View>
                <Text style={styles.label}>FC RECUP.</Text>
                {/* La recuperación alta no siempre es mala per se en este contexto, la dejamos estática o puedes agregarle su propia regla */}
                <Text style={styles.metric}>{mediciones.fcRecup} <Text style={styles.unit}>lpm</Text></Text>
              </View>
            </View>
          </View>

          {/* Balanza */}
          <View style={styles.sensorCard}>
            <Text style={styles.sensorTitle}>Balanza</Text>
            <View style={styles.row}>
              <View style={{marginRight: 15}}>
                <Text style={styles.label}>PESO</Text>
                <Text style={styles.metric}>{mediciones.peso} <Text style={styles.unit}>kg</Text></Text>
              </View>
              <View style={{marginRight: 15}}>
                <Text style={styles.label}>IMC</Text>
                <Text style={[styles.metric, { color: evaluarColor('imc', mediciones.imc) }]}>
                  {mediciones.imc} <Text style={styles.unit}>kg/m²</Text>
                </Text>
              </View>
              <View>
                <Text style={styles.label}>GRASA</Text>
                <Text style={styles.metric}>{mediciones.grasa} <Text style={styles.unit}>%</Text></Text>
              </View>
            </View>
          </View>

          {/* Prueba de esfuerzo */}
          <View style={styles.sensorCard}>
            <Text style={styles.sensorTitle}>Prueba esfuerzo</Text>
            <Text style={styles.label}>VO₂ MÁX</Text>
            <Text style={styles.metric}>{mediciones.vo2Max} <Text style={styles.unit}>ml/kg·min</Text></Text>
          </View>
        </View>

        <TouchableOpacity style={styles.btnPrimary} onPress={simularMediciones}>
          <Text style={styles.btnPrimaryText}>Volver a medir</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderPaso3 = () => {
    const listaObjetivos = ['Fuerza', 'Cardio', 'Flexibilidad', 'Natación', 'Recreativo'];
    const listaExperiencia = ['Principiante', 'Intermedio', 'Avanzado'];
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepSubtitle}>PASO 3 - TU OBJETIVO</Text>
        <Text style={styles.stepTitle}>¿Qué quieres entrenar hoy?</Text>
        <Text style={[styles.label, { marginTop: 20, marginBottom: 15 }]}>OBJETIVO</Text>
        <View style={styles.chipContainer}>{listaObjetivos.map(obj => (<TouchableOpacity key={obj} style={[styles.chip, objetivo === obj && styles.chipActive]} onPress={() => setObjetivo(obj)}><Text style={[styles.chipText, objetivo === obj && styles.chipTextActive]}>{obj}</Text></TouchableOpacity>))}</View>
        <Text style={[styles.label, { marginTop: 30, marginBottom: 15 }]}>EXPERIENCIA</Text>
        <View style={styles.chipContainer}>{listaExperiencia.map(exp => (<TouchableOpacity key={exp} style={[styles.chip, experiencia === exp && styles.chipActive]} onPress={() => setExperiencia(exp)}><Text style={[styles.chipText, experiencia === exp && styles.chipTextActive]}>{exp}</Text></TouchableOpacity>))}</View>
        <View style={styles.sliderHeader}><Text style={styles.label}>DURACIÓN DE LA SESIÓN</Text><Text style={styles.sliderValue}> — {duracion} MIN</Text></View>
        <Slider style={{ width: '100%', height: 40, marginTop: 10 }} minimumValue={30} maximumValue={120} step={10} value={duracion} onValueChange={(valor) => setDuracion(valor)} minimumTrackTintColor="#ea580c" maximumTrackTintColor="#e2e8f0" thumbTintColor="#ea580c"/>
        <View style={styles.sliderLabels}><Text style={styles.sliderLabelText}>30 min</Text><Text style={styles.sliderLabelText}>2 h</Text></View>
      </View>
    );
  };

  const renderPaso4 = () => {
    const listaSintomas = ['Dolor de pecho al esforzarte', 'Mareos o pérdida de equilibrio', 'Lesión articular u ósea', 'Medicación permanente'];
    const listaCondiciones = ['Asma', 'Hipertensión', 'Lesión de rodilla', 'Lesión lumbar', 'Diabetes', 'Problema cardíaco', 'Embarazo'];
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepSubtitle}>PASO 4 - APTITUD FÍSICA</Text>
        <Text style={styles.stepTitle}>Antes de entrenar</Text>
        <Text style={styles.stepDescription}>Marca lo que corresponda. Esto nos ayuda a cuidarte.</Text>
        <Text style={[styles.label, { marginTop: 20, marginBottom: 15 }]}>HOY PRESENTAS</Text>
        <View style={styles.checkboxGrid}>
          {listaSintomas.map(sintoma => {
            const isSelected = sintomasHoy.includes(sintoma);
            return (<TouchableOpacity key={sintoma} style={[styles.checkboxCard, isSelected && styles.checkboxCardActive]} onPress={() => toggleSintoma(sintoma)}><View style={[styles.checkboxIcon, isSelected && styles.checkboxIconActive]}>{isSelected && <Text style={styles.checkboxCheck}>✓</Text>}</View><Text style={[styles.checkboxText, isSelected && styles.checkboxTextActive]}>{sintoma}</Text></TouchableOpacity>);
          })}
        </View>
        <Text style={[styles.label, { marginTop: 30, marginBottom: 15 }]}>CONDICIONES DE SALUD</Text>
        <View style={styles.chipContainer}>
          {listaCondiciones.map(cond => {
            const isSelected = condicionesSalud.includes(cond);
            return (<TouchableOpacity key={cond} style={[styles.chip, isSelected && styles.chipActive]} onPress={() => toggleCondicion(cond)}><Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{cond}</Text></TouchableOpacity>);
          })}
        </View>
      </View>
    );
  };

  const renderPaso5 = () => {
    // Extraemos el primer nombre para hacerlo más cercano
    const primerNombre = formData.nombre.split(' ')[0] || 'Estudiante';
    
    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepSubtitle}>CASI LISTO</Text>
        <Text style={styles.stepTitle}>Gracias, {primerNombre}</Text>
        <Text style={styles.stepDescription}>Registramos tus mediciones. En un momento el encargado del gimnasio validará tu evaluación de aptitud. ¡Que tengas un gran entrenamiento!</Text>
        
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <View style={styles.summaryIcon}>
              <Text style={styles.summaryIconText}>⚡</Text>
            </View>
            <View style={styles.summaryHeaderTextContainer}>
              <Text style={styles.summaryCardTitle}>¡Listo para entrenar!</Text>
              <Text style={styles.summaryCardDesc}>El encargado revisará tu evaluación de aptitud y confirmará las recomendaciones para tu sesión de hoy.</Text>
            </View>
          </View>
          
          <View style={styles.summaryList}>
            {[
              'Realiza un buen calentamiento antes de comenzar',
              'Hidrátate durante toda tu sesión',
              'Si te sientes mal, avisa de inmediato al profesor'
            ].map((item, idx) => (
              <View key={idx} style={styles.summaryListItem}>
                <View style={styles.checkCircle}><Text style={styles.checkCircleText}>✓</Text></View>
                <Text style={styles.summaryListItemText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.progressContainer}>
          {nombresPasos.map((nombre, index) => (
            <View key={index} style={styles.progressStep}>
              <View style={[styles.progressBar, pasoActual >= index + 1 ? styles.progressActive : styles.progressInactive]} />
              <Text style={[styles.progressText, pasoActual >= index + 1 ? styles.textActive : styles.textInactive]}>{nombre}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* BODY */}
      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        {pasoActual === 1 && renderPaso1()}
        {pasoActual === 2 && renderPaso2()}
        {pasoActual === 3 && renderPaso3()}
        {pasoActual === 4 && renderPaso4()}
        {pasoActual === 5 && renderPaso5()}
      </ScrollView>

      {/* FOOTER */}
      <View style={styles.footer}>
        {/* Mostramos el botón "Atrás" solo en los pasos 2, 3 y 4 */}
        {pasoActual > 1 && pasoActual < totalPasos && (
          <TouchableOpacity onPress={retroceder} style={styles.btnBack}>
            <Text style={styles.btnBackText}>← Atrás</Text>
          </TouchableOpacity>
        )}
        
        {pasoActual < totalPasos ? (
          <TouchableOpacity onPress={avanzar} style={styles.btnNext}>
            <Text style={styles.btnNextText}>Continuar →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.btnFinal} onPress={registrarIngreso}>
            <Text style={styles.btnFinalText}>Registrar mi ingreso</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

// --- ESTILOS ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { padding: 20, paddingTop: 40, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', backgroundColor: '#fff' },
  progressContainer: { flexDirection: 'row', justifyContent: 'space-between' },
  progressStep: { flex: 1, marginHorizontal: 2 },
  progressBar: { height: 4, borderRadius: 2, marginBottom: 8 },
  progressActive: { backgroundColor: '#ea580c' },
  progressInactive: { backgroundColor: '#f1f5f9' },
  progressText: { fontSize: 10, textAlign: 'center', fontWeight: 'bold' },
  textActive: { color: '#ea580c' },
  textInactive: { color: '#94a3b8' },
  
  content: { flex: 1, padding: 30 },
  stepContainer: { paddingBottom: 40 },
  stepSubtitle: { color: '#ea580c', fontWeight: 'bold', fontSize: 12, letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' },
  stepTitle: { fontSize: 28, fontWeight: 'bold', color: '#0f172a', marginBottom: 10 },
  stepDescription: { fontSize: 16, color: '#64748b', marginBottom: 30 },
  
  scanCard: { backgroundColor: '#fff5f0', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#fed7aa', marginBottom: 20 },
  scanCardTitle: { fontSize: 16, fontWeight: 'bold', color: '#1e293b' },
  scanCardDesc: { color: '#64748b', marginTop: 4 },
  dividerText: { textAlign: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 'bold', marginVertical: 20 },
  
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 10, fontWeight: 'bold', color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', padding: 15, borderRadius: 10, fontSize: 16, color: '#1e293b', marginTop: 8 },
  row: { flexDirection: 'row' },
  
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  sensorCard: { width: '48%', backgroundColor: '#fff', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 15 },
  sensorTitle: { fontSize: 14, fontWeight: 'bold', color: '#1e293b', marginBottom: 15 },
  metric: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' },
  unit: { fontSize: 12, color: '#94a3b8' },
  
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 30, borderWidth: 1, borderColor: '#e2e8f0' },
  chipActive: { backgroundColor: '#ea580c', borderColor: '#ea580c' },
  chipText: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  chipTextActive: { color: '#fff', fontWeight: 'bold' },
  sliderHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 40 },
  sliderValue: { fontSize: 12, fontWeight: 'bold', color: '#ea580c', textTransform: 'uppercase' },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 5 },
  sliderLabelText: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  
  checkboxGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  checkboxCard: { width: '48%', flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 15 },
  checkboxCardActive: { backgroundColor: '#fef2f2', borderColor: '#ef4444' },
  checkboxIcon: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1', marginRight: 12, justifyContent: 'center', alignItems: 'center' },
  checkboxIconActive: { backgroundColor: '#ef4444', borderColor: '#ef4444' },
  checkboxCheck: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  checkboxText: { flex: 1, fontSize: 14, color: '#64748b' },
  checkboxTextActive: { color: '#1e293b' },
  
  /* Nuevos estilos Paso 5 (Tarjeta de Resumen) */
  summaryCard: { backgroundColor: '#fff7ed', padding: 25, borderRadius: 16, marginTop: 10 },
  summaryHeader: { flexDirection: 'row', marginBottom: 20 },
  summaryIcon: { backgroundColor: '#ea580c', width: 45, height: 45, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  summaryIconText: { color: 'white', fontSize: 20 },
  summaryHeaderTextContainer: { flex: 1 },
  summaryCardTitle: { fontSize: 18, fontWeight: 'bold', color: '#1e293b', marginBottom: 5 },
  summaryCardDesc: { fontSize: 14, color: '#475569', lineHeight: 20 },
  summaryList: { marginTop: 10, gap: 15 },
  summaryListItem: { flexDirection: 'row', alignItems: 'center' },
  checkCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fed7aa', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  checkCircleText: { color: '#ea580c', fontSize: 12, fontWeight: 'bold' },
  summaryListItemText: { fontSize: 15, color: '#334155', flex: 1 },

  btnPrimary: { backgroundColor: '#ea580c', padding: 15, borderRadius: 30, alignSelf: 'flex-start', marginTop: 10 },
  btnPrimaryText: { color: '#fff', fontWeight: 'bold', fontSize: 16, paddingHorizontal: 20 },
  
  footer: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  btnBack: { padding: 15 },
  btnBackText: { color: '#64748b', fontWeight: 'bold', fontSize: 16 },
  btnNext: { backgroundColor: '#0f172a', paddingVertical: 15, paddingHorizontal: 30, borderRadius: 30 },
  btnNextText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnFinal: { width: '100%', backgroundColor: '#ea580c', paddingVertical: 18, borderRadius: 16, alignItems: 'center' }, // Botón final expandido y rediseñado
  btnFinalText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
});