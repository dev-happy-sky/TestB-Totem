import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, SafeAreaView, Alert } from 'react-native';
import Slider from '@react-native-community/slider';

import {
  actualizarSocio, enviarEvaluacion, identificarSocio, registrarSocio, type CambiosSocio, type RespuestaIdentificacion,
} from '../services/api';
import { isoADisplay, parseFechaNacimiento, telefonoValido } from '../utils/fecha';
import { matriculaValida, MENSAJE_MATRICULA, normalizarMatricula } from '../utils/matricula';

type Fase = 'ingreso' | 'registrado' | 'nuevo';
type Previas = Extract<RespuestaIdentificacion, { registrado: true }>;

// Campos de `socios`. La fecha se escribe como DD/MM/AAAA y el teléfono es opcional.
const FORM_INICIAL = { matricula: '', nombre: '', apellido: '', fechaNacimiento: '', telefono: '', plan: '' };
const MEDICIONES_INICIALES = {
  presionSys: 117, presionDia: 81, fcReposo: 79, fcRecup: 101, peso: '90.3', imc: '27.3', grasa: '18.3', vo2Max: '44.6', masaMuscular: '31.2',
};

const formatearFecha = (iso: string) => {
  const f = new Date(iso);
  return Number.isNaN(f.getTime()) ? '' : f.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const ETIQUETA_ESTADO = { pendiente: 'pendiente de revisión', revisada: 'revisada', derivada: 'derivada' } as const;

export default function App() {
  // --- NAVEGACIÓN ---
  const [pasoActual, setPasoActual] = useState(1);
  const totalPasos = 5;
  const nombresPasos = ['Identificación', 'Mediciones', 'Objetivo', 'Salud', 'Listo'];

  // --- ESTADO PASO 1 ---
  const [formData, setFormData] = useState(FORM_INICIAL);
  const [fase, setFase] = useState<Fase>('ingreso');
  const [previas, setPrevias] = useState<Previas | null>(null);
  const [datosServidor, setDatosServidor] = useState<Omit<typeof FORM_INICIAL, 'matricula'> | null>(null);
  const [errorIdentificacion, setErrorIdentificacion] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [inicioEvaluacion, setInicioEvaluacion] = useState<string | null>(null);

  // --- CONSENTIMIENTO (R.183) ---
  const [consentimiento, setConsentimiento] = useState(false);

  // --- ESTADO PASO 2 ---
  const [mediciones, setMediciones] = useState(MEDICIONES_INICIALES);

  // --- ESTADO PASO 3 ---
  const [objetivo, setObjetivo] = useState('Fuerza');
  const [experiencia, setExperiencia] = useState('Intermedio');
  const [duracion, setDuracion] = useState(60);
  const [diasSemana, setDiasSemana] = useState<number | null>(null);

  // --- ESTADO PASO 4 ---
  const [lesionesPrevias, setLesionesPrevias] = useState('');
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
      vo2Max: (Math.random() * (60 - 30) + 30).toFixed(1),
      masaMuscular: (Math.random() * (45 - 25) + 25).toFixed(1)
    });
  };

  const toggleSintoma = (sintoma: string) => {
    setSintomasHoy(prev => prev.includes(sintoma) ? prev.filter(s => s !== sintoma) : [...prev, sintoma]);
  };

  const toggleCondicion = (condicion: string) => {
    setCondicionesSalud(prev => prev.includes(condicion) ? prev.filter(c => c !== condicion) : [...prev, condicion]);
  };

  // Vuelve al estado inicial y borra los datos de la persona (cancelar o terminar, R.9 y R.25).
  const reiniciar = () => {
    setFormData(FORM_INICIAL);
    setFase('ingreso');
    setPrevias(null);
    setDatosServidor(null);
    setErrorIdentificacion('');
    setConsentimiento(false);
    setInicioEvaluacion(null);
    setMediciones(MEDICIONES_INICIALES);
    setDiasSemana(null);
    setLesionesPrevias('');
    setPasoActual(1);
  };

  const cancelarEvaluacion = () => {
    Alert.alert('¿Cancelar la evaluación?', 'Se borrarán los datos ingresados y volverás al inicio.', [
      { text: 'Seguir evaluándome', style: 'cancel' },
      { text: 'Sí, cancelar', style: 'destructive', onPress: reiniciar },
    ]);
  };

  // R.1, R.2, R.4, R.7: identifica por matrícula y muestra si ya está registrado y si tiene una evaluación vigente.
  const buscarMatricula = async () => {
    setErrorIdentificacion('');
    if (!matriculaValida(formData.matricula)) {
      setErrorIdentificacion(MENSAJE_MATRICULA);
      return;
    }
    const matricula = normalizarMatricula(formData.matricula);
    setOcupado(true);
    const resultado = await identificarSocio(matricula);
    setOcupado(false);
    if (!resultado.ok) {
      setErrorIdentificacion(resultado.mensaje);
      return;
    }
    if (resultado.data.registrado) {
      const { socio } = resultado.data;
      const datos = {
        nombre: socio.nombre, apellido: socio.apellido, fechaNacimiento: isoADisplay(socio.fecha_nacimiento),
        telefono: socio.telefono ?? '', plan: socio.plan_membresia ?? '',
      };
      setPrevias(resultado.data);
      setDatosServidor(datos);
      setFormData({ matricula, ...datos });
      setFase('registrado');
    } else {
      setPrevias(null);
      setDatosServidor(null);
      setFormData({ ...FORM_INICIAL, matricula });
      setFase('nuevo');
    }
  };

  const datosPersonalesValidos = () => {
    if (formData.nombre.trim().length < 2 || formData.apellido.trim().length < 2 || formData.plan.trim().length < 2) {
      Alert.alert('Datos incompletos', 'Completa tu nombre, tu apellido y tu plan de membresía para continuar.');
      return false;
    }
    if (!parseFechaNacimiento(formData.fechaNacimiento)) {
      Alert.alert('Fecha de nacimiento inválida', 'Escríbela como DD/MM/AAAA, por ejemplo 15/03/2002.');
      return false;
    }
    if (!telefonoValido(formData.telefono)) {
      Alert.alert('Teléfono inválido', 'Usa solo números, espacios, + o guiones (mínimo 6 dígitos), o déjalo en blanco.');
      return false;
    }
    return true;
  };

  const empezarEvaluacion = () => {
    setInicioEvaluacion(new Date().toISOString());
    setPasoActual(2);
  };

  // R.3: alta de un socio nuevo. Si hay un posible duplicado (R.11) el usuario confirma que es otra persona.
  const registrarNuevo = async (confirmarDuplicado = false) => {
    setOcupado(true);
    const resultado = await registrarSocio({
      matricula: normalizarMatricula(formData.matricula), nombre: formData.nombre.trim(), apellido: formData.apellido.trim(),
      fecha_nacimiento: parseFechaNacimiento(formData.fechaNacimiento) as string,
      ...(formData.telefono.trim() ? { telefono: formData.telefono.trim() } : {}),
      plan_membresia: formData.plan.trim(), confirmar_duplicado: confirmarDuplicado,
    });
    setOcupado(false);
    if (resultado.ok) {
      empezarEvaluacion();
    } else if (resultado.code === 'posible_duplicado') {
      Alert.alert('¿Ya estás registrado?', `${resultado.mensaje}`, [
        { text: 'Revisar mis datos', style: 'cancel' },
        { text: 'Soy otra persona', onPress: () => registrarNuevo(true) },
      ]);
    } else if (resultado.code === 'matricula_registrada') {
      Alert.alert('Matrícula ya registrada', 'Busca tu matrícula nuevamente para continuar.');
      setFase('ingreso');
    } else {
      Alert.alert('No se pudo registrar', resultado.mensaje);
    }
  };

  // R.5: si cambió algún dato personal, se actualiza antes de empezar. Solo se envían los campos que cambiaron.
  const continuarRegistrado = async () => {
    const cambios: CambiosSocio = {};
    if (datosServidor) {
      if (formData.nombre.trim() !== datosServidor.nombre) cambios.nombre = formData.nombre.trim();
      if (formData.apellido.trim() !== datosServidor.apellido) cambios.apellido = formData.apellido.trim();
      if (formData.fechaNacimiento.trim() !== datosServidor.fechaNacimiento) {
        cambios.fecha_nacimiento = parseFechaNacimiento(formData.fechaNacimiento) as string;
      }
      if (formData.telefono.trim() !== datosServidor.telefono) cambios.telefono = formData.telefono.trim();
      if (formData.plan.trim() !== datosServidor.plan) cambios.plan_membresia = formData.plan.trim();
    }
    if (Object.keys(cambios).length > 0) {
      setOcupado(true);
      const resultado = await actualizarSocio(formData.matricula, cambios);
      setOcupado(false);
      if (!resultado.ok) {
        Alert.alert('No se pudieron actualizar tus datos', resultado.mensaje);
        return;
      }
    }
    empezarEvaluacion();
  };

  const avanzar = async () => {
    if (pasoActual === 1) {
      if (fase === 'ingreso') {
        Alert.alert('Busca tu matrícula', 'Ingresa tu matrícula y presiona "Buscar" para continuar.');
        return;
      }
      if (!consentimiento) {
        Alert.alert("Consentimiento requerido", "Para continuar debes aceptar el uso de tus datos de salud.");
        return;
      }
      if (!datosPersonalesValidos()) return;
      if (fase === 'nuevo') await registrarNuevo();
      else await continuarRegistrado();
      return;
    }
    if (pasoActual === 3 && diasSemana === null) {
      Alert.alert('Falta un dato', 'Indica cuántos días a la semana puedes entrenar.');
      return;
    }
    if (pasoActual < totalPasos) setPasoActual(pasoActual + 1);
  };
  const retroceder = () => { if (pasoActual > 1) setPasoActual(pasoActual - 1); };

  // Envía la evaluación completa al backend
  const registrarIngreso = async () => {
    if (!consentimiento) {
      Alert.alert("Consentimiento requerido", "Debes aceptar el uso de tus datos de salud para registrar tu ingreso.");
      return;
    }
    const payload = {
      consentimiento,
      estudiante: {
        matricula: normalizarMatricula(formData.matricula), nombre: formData.nombre.trim(), apellido: formData.apellido.trim(),
        fecha_nacimiento: parseFechaNacimiento(formData.fechaNacimiento) ?? undefined,
        telefono: formData.telefono.trim() || undefined, plan_membresia: formData.plan.trim(),
      },
      mediciones: mediciones,
      entrenamiento: { objetivo, experiencia, duracion, diasSemana: diasSemana ?? undefined },
      salud: { sintomas: sintomasHoy, condiciones: condicionesSalud, lesionesPrevias: lesionesPrevias.trim() || undefined },
      totem_serial: process.env.EXPO_PUBLIC_TOTEM_SERIAL,
      totem_sucursal: process.env.EXPO_PUBLIC_TOTEM_SUCURSAL,
      inicio: inicioEvaluacion ?? undefined,
    };

    setOcupado(true);
    const resultado = await enviarEvaluacion(payload);
    setOcupado(false);

    if (resultado.ok) {
      Alert.alert("¡Éxito!", "Tus datos han sido enviados al profesor.");
      reiniciar();
    } else if (resultado.status === 0) {
      Alert.alert("Error de conexión", resultado.mensaje);
    } else {
      Alert.alert("Error del servidor", `Código ${resultado.status}: ${resultado.mensaje}`);
    }
  };

  // --- FUNCIONES DE RENDERIZADO ---
  const renderPaso1 = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepSubtitle}>PASO 1 - IDENTIFICACIÓN</Text>
      <Text style={styles.stepTitle}>Registremos tu ingreso</Text>
      <Text style={styles.stepDescription}>Ingresa tu matrícula para identificarte. Si es tu primera vez, te pediremos algunos datos.</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>MATRÍCULA</Text>
        <TextInput
          style={styles.input} value={formData.matricula} editable={fase === 'ingreso'} autoCapitalize="characters"
          accessibilityLabel="Matrícula" onChangeText={(t) => setFormData({ ...formData, matricula: t })}
        />
      </View>
      {errorIdentificacion !== '' && <Text style={styles.errorText} accessibilityRole="alert">{errorIdentificacion}</Text>}

      {fase === 'ingreso' ? (
        <TouchableOpacity style={styles.btnPrimary} onPress={buscarMatricula} disabled={ocupado} accessibilityRole="button">
          <Text style={styles.btnPrimaryText}>{ocupado ? 'Buscando…' : 'Buscar mi matrícula'}</Text>
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity onPress={reiniciar} accessibilityRole="button">
            <Text style={styles.linkText}>Usar otra matrícula</Text>
          </TouchableOpacity>

          {fase === 'registrado' && previas && (
            <View style={styles.infoBanner}>
              <Text style={styles.infoTitle}>Hola, {previas.socio.nombre.split(' ')[0]}</Text>
              {previas.evaluacion_vigente ? (
                <Text style={styles.infoText}>
                  Ya completaste una evaluación el {formatearFecha(previas.evaluacion_vigente.fecha)} ({ETIQUETA_ESTADO[previas.evaluacion_vigente.estado]}).
                  Es válida por {previas.vigencia_horas} horas; no necesitas repetirla, pero puedes hacerlo si lo requieres.
                </Text>
              ) : (
                <Text style={styles.infoText}>Te encontramos. Revisa que tus datos estén al día antes de continuar.</Text>
              )}
              {previas.evaluaciones_previas.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.infoText}>Evaluaciones anteriores:</Text>
                  {previas.evaluaciones_previas.map((e, i) => (
                    <Text key={i} style={styles.infoText}>• {formatearFecha(e.fecha)} · {ETIQUETA_ESTADO[e.estado]}</Text>
                  ))}
                </View>
              )}
            </View>
          )}
          {fase === 'nuevo' && (
            <View style={styles.infoBanner}>
              <Text style={styles.infoTitle}>No encontramos tu matrícula</Text>
              <Text style={styles.infoText}>Completa tus datos para registrarte.</Text>
            </View>
          )}

          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}><Text style={styles.label}>NOMBRE</Text><TextInput style={styles.input} value={formData.nombre} accessibilityLabel="Nombre" onChangeText={(t) => setFormData({ ...formData, nombre: t })} /></View>
            <View style={[styles.inputGroup, { flex: 1 }]}><Text style={styles.label}>APELLIDO</Text><TextInput style={styles.input} value={formData.apellido} accessibilityLabel="Apellido" onChangeText={(t) => setFormData({ ...formData, apellido: t })} /></View>
          </View>
          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}><Text style={styles.label}>FECHA DE NACIMIENTO</Text><TextInput style={styles.input} value={formData.fechaNacimiento} placeholder="DD/MM/AAAA" keyboardType="numbers-and-punctuation" accessibilityLabel="Fecha de nacimiento" onChangeText={(t) => setFormData({ ...formData, fechaNacimiento: t })} /></View>
            <View style={[styles.inputGroup, { flex: 1 }]}><Text style={styles.label}>TELÉFONO (OPCIONAL)</Text><TextInput style={styles.input} value={formData.telefono} keyboardType="phone-pad" accessibilityLabel="Teléfono" onChangeText={(t) => setFormData({ ...formData, telefono: t })} /></View>
          </View>
          <View style={styles.inputGroup}><Text style={styles.label}>PLAN DE MEMBRESÍA</Text><TextInput style={styles.input} value={formData.plan} accessibilityLabel="Plan de membresía" onChangeText={(t) => setFormData({ ...formData, plan: t })} /></View>

          <TouchableOpacity style={[styles.checkboxCard, { width: "100%" }]} onPress={() => setConsentimiento(!consentimiento)} accessibilityRole="checkbox" accessibilityState={{ checked: consentimiento }}>
            <View style={[styles.checkboxIcon, consentimiento && styles.checkboxIconActive]}>{consentimiento && <Text style={styles.checkboxCheck}>✓</Text>}</View>
            <Text style={styles.checkboxText}>Autorizo el registro y uso de mis datos personales y de salud para evaluar mi aptitud física. Esta herramienta es de apoyo y no reemplaza el criterio de un profesional de la salud.</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  const renderPaso2 = () => {
    const evaluarColor = (tipo: string, valor1: string | number, valor2: string | number = 0) => {
      const v1 = parseFloat(valor1.toString());
      const v2 = parseFloat(valor2.toString());
      let esAnormal = false;

      switch(tipo) {
        case 'presion':
          esAnormal = v1 >= 130 || v1 < 90 || v2 >= 85 || v2 < 60;
          break;
        case 'fc':
          esAnormal = v1 > 100 || v1 < 60;
          break;
        case 'imc':
          esAnormal = v1 >= 25.0 || v1 < 18.5;
          break;
      }
      return esAnormal ? '#ef4444' : '#0f172a';
    };

    return (
      <View style={styles.stepContainer}>
        <Text style={styles.stepSubtitle}>PASO 2 - ESTACIÓN DE SENSORES</Text>
        <Text style={styles.stepTitle}>Tus mediciones de hoy</Text>
        <Text style={styles.stepDescription}>Los sensores del tótem se conectan por Bluetooth. Sigue las indicaciones y presiona medir.</Text>
        
        <View style={styles.grid}>
          <View style={styles.sensorCard}>
            <Text style={styles.sensorTitle}>Tensiómetro</Text>
            <Text style={styles.label}>PRESIÓN</Text>
            <Text style={[styles.metric, { color: evaluarColor('presion', mediciones.presionSys, mediciones.presionDia) }]}>
              {mediciones.presionSys}/{mediciones.presionDia} <Text style={styles.unit}>mmHg</Text>
            </Text>
          </View>
          
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
                <Text style={styles.metric}>{mediciones.fcRecup} <Text style={styles.unit}>lpm</Text></Text>
              </View>
            </View>
          </View>

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
              <View style={{marginRight: 15}}>
                <Text style={styles.label}>GRASA</Text>
                <Text style={styles.metric}>{mediciones.grasa} <Text style={styles.unit}>%</Text></Text>
              </View>
              <View>
                <Text style={styles.label}>MASA MUSCULAR</Text>
                <Text style={styles.metric}>{mediciones.masaMuscular} <Text style={styles.unit}>kg</Text></Text>
              </View>
            </View>
          </View>

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
        <Text style={[styles.label, { marginTop: 30, marginBottom: 15 }]}>DÍAS A LA SEMANA QUE PUEDES ENTRENAR</Text>
        <View style={styles.chipContainer}>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <TouchableOpacity key={d} style={[styles.chip, diasSemana === d && styles.chipActive]} onPress={() => setDiasSemana(d)} accessibilityRole="button" accessibilityLabel={`${d} ${d === 1 ? 'día' : 'días'} a la semana`} accessibilityState={{ selected: diasSemana === d }}>
              <Text style={[styles.chipText, diasSemana === d && styles.chipTextActive]}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>
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
        <Text style={[styles.label, { marginTop: 30, marginBottom: 15 }]}>LESIONES PREVIAS (OPCIONAL)</Text>
        <TextInput style={styles.input} value={lesionesPrevias} multiline maxLength={500} accessibilityLabel="Lesiones previas" placeholder="Por ejemplo: esguince de tobillo en 2025" onChangeText={setLesionesPrevias} />
      </View>
    );
  };

  const renderPaso5 = () => {
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

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        {pasoActual === 1 && renderPaso1()}
        {pasoActual === 2 && renderPaso2()}
        {pasoActual === 3 && renderPaso3()}
        {pasoActual === 4 && renderPaso4()}
        {pasoActual === 5 && renderPaso5()}
      </ScrollView>

      <View style={styles.footer}>
        {pasoActual > 1 && pasoActual < totalPasos && (
          <TouchableOpacity onPress={retroceder} style={styles.btnBack}>
            <Text style={styles.btnBackText}>← Atrás</Text>
          </TouchableOpacity>
        )}
        {(pasoActual > 1 || fase !== 'ingreso') && (
          <TouchableOpacity onPress={cancelarEvaluacion} style={styles.btnBack} accessibilityRole="button">
            <Text style={styles.btnBackText}>Cancelar evaluación</Text>
          </TouchableOpacity>
        )}

        {pasoActual === 1 && fase === 'ingreso' ? null : pasoActual < totalPasos ? (
          <TouchableOpacity onPress={avanzar} disabled={ocupado} style={styles.btnNext}>
            <Text style={styles.btnNextText}>{ocupado ? 'Guardando…' : 'Continuar →'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.btnFinal} onPress={registrarIngreso} disabled={ocupado}>
            <Text style={styles.btnFinalText}>Registrar mi ingreso</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

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
  
  errorText: { color: '#dc2626', marginBottom: 12, fontWeight: '600' },
  linkText: { color: '#475569', textDecorationLine: 'underline', marginBottom: 16, fontWeight: '600' },
  infoBanner: { backgroundColor: '#f1f5f9', padding: 16, borderRadius: 12, marginBottom: 20 },
  infoTitle: { fontSize: 16, fontWeight: 'bold', color: '#1e293b', marginBottom: 4 },
  infoText: { color: '#475569', fontSize: 14, lineHeight: 20 },
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
  btnFinal: { width: '100%', backgroundColor: '#ea580c', paddingVertical: 18, borderRadius: 16, alignItems: 'center' },
  btnFinalText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
});