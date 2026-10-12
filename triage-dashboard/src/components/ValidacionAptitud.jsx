"use client";
import React, { useState } from 'react';

const NIVELES = [
  { id: 'A1', label: 'Riesgo', txt: 'text-red-600', borderActivo: 'border-red-600', bgActivo: 'bg-red-50' },
  { id: 'A2', label: 'Precaución', txt: 'text-orange-500', borderActivo: 'border-orange-500', bgActivo: 'bg-orange-50' },
  { id: 'A3', label: 'Apto mod.', txt: 'text-yellow-600', borderActivo: 'border-yellow-500', bgActivo: 'bg-yellow-50' },
  { id: 'A4', label: 'Apto', txt: 'text-green-600', borderActivo: 'border-green-600', bgActivo: 'bg-green-50' },
];

// Decisión del encargado: confirmar/ajustar la categoría (R.105) o derivar con motivo (R.106, R.107),
// con observaciones opcionales (R.129). `onValidar` devuelve una promesa { ok, error }.
// Se monta con `key` por evaluación, así que el estado inicial sale de las props.
export default function ValidacionAptitud({ estudiante, onValidar }) {
  const nivelSugeridoIA = estudiante?.iaSugerida || 'A3';
  const cerrado = estudiante?.estado === 'validado';

  const [nivelSeleccionado, setNivelSeleccionado] = useState(estudiante?.nivelFinal || nivelSugeridoIA);
  const [observaciones, setObservaciones] = useState('');
  const [derivando, setDerivando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  if (!estudiante) return null;

  const difiere = nivelSeleccionado !== nivelSugeridoIA;
  const getLabel = (id) => NIVELES.find((n) => n.id === id)?.label;
  const nivelMostrado = estudiante.nivelFinal || nivelSeleccionado;

  const enviar = async (derivar) => {
    setError('');
    setEnviando(true);
    const resultado = await onValidar(estudiante.idUnico, nivelSeleccionado, {
      observaciones: observaciones.trim() || null,
      derivar,
      motivo: derivar ? motivo.trim() : null,
    });
    setEnviando(false);
    if (!resultado?.ok) setError(resultado?.error || 'No se pudo guardar la decisión.');
  };

  return (
    <div className="mt-8 border-t border-slate-200 pt-6">
      <div className="flex justify-between items-end mb-4">
        <h3 className="font-bold text-slate-800">Validar aptitud</h3>
        <span className="text-sm text-slate-400 font-medium">
          {cerrado ? '🔒 Clasificación cerrada' : 'Confirma, ajusta o deriva la clasificación IA'}
        </span>
      </div>

      <div className="flex gap-3" role="group" aria-label="Categoría de aptitud">
        {NIVELES.map((nivel) => {
          const activo = nivelMostrado === nivel.id;
          let clases = 'flex-1 flex flex-col items-center justify-center py-3 rounded-xl border-2 transition-all duration-200 ';
          if (cerrado) {
            clases += activo ? `${nivel.borderActivo} ${nivel.bgActivo}` : 'border-slate-100 bg-slate-50 opacity-40 cursor-not-allowed';
          } else {
            clases += activo ? `${nivel.borderActivo} ${nivel.bgActivo}` : 'bg-white border-slate-100 hover:border-slate-300 hover:bg-slate-50 cursor-pointer';
          }
          return (
            <button
              key={nivel.id}
              onClick={() => !cerrado && !derivando && setNivelSeleccionado(nivel.id)}
              disabled={cerrado || derivando}
              aria-pressed={activo}
              className={clases}
            >
              <span className={`text-xl font-bold ${activo ? nivel.txt : 'text-slate-400'}`}>{nivel.id}</span>
              <span className={`text-xs font-semibold mt-1 ${activo ? 'text-slate-700' : 'text-slate-400'}`}>{nivel.label}</span>
            </button>
          );
        })}
      </div>

      {cerrado ? (
        <div className={`mt-5 rounded-xl p-4 border ${estudiante.estadoRevision === 'derivada' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          <p className="text-sm font-bold text-slate-800">
            {estudiante.estadoRevision === 'derivada' ? 'Derivado a evaluación médica externa' : 'Evaluación revisada'}
            {estudiante.revisadoPor ? ` por ${estudiante.revisadoPor}` : ''}
          </p>
          {estudiante.motivoDerivacion && (
            <p className="text-sm text-slate-700 mt-2"><strong>Motivo:</strong> {estudiante.motivoDerivacion}</p>
          )}
          {estudiante.observaciones && (
            <p className="text-sm text-slate-700 mt-2"><strong>Observaciones:</strong> {estudiante.observaciones}</p>
          )}
        </div>
      ) : (
        <div className="mt-5">
          {difiere && !derivando && (
            <div className="bg-orange-50 rounded-xl p-4 border-l-4 border-orange-500 mb-4">
              <p className="text-sm text-slate-700">Modificaste la aptitud a <strong className="text-orange-600">{getLabel(nivelSeleccionado)}</strong> (IA sugirió {getLabel(nivelSugeridoIA)}).</p>
            </div>
          )}

          <label htmlFor="observaciones" className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
            Observaciones del encargado (opcional)
          </label>
          <textarea
            id="observaciones"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            maxLength={2000}
            rows={3}
            className="w-full border border-slate-300 rounded-lg p-3 text-sm text-slate-800 mb-4"
          />

          {derivando ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
              <label htmlFor="motivo" className="text-sm font-bold text-red-800 block mb-2">
                Motivo de la derivación a evaluación médica
              </label>
              <textarea
                id="motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={1000}
                rows={2}
                required
                className="w-full border border-red-300 rounded-lg p-3 text-sm text-slate-800"
              />
              <div className="flex gap-3 mt-3">
                <button
                  onClick={() => enviar(true)}
                  disabled={enviando || !motivo.trim()}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl disabled:opacity-50"
                >
                  Confirmar derivación
                </button>
                <button
                  onClick={() => { setDerivando(false); setMotivo(''); setError(''); }}
                  disabled={enviando}
                  className="px-4 py-3 rounded-xl border border-slate-300 text-slate-600 font-semibold"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={() => enviar(false)}
                disabled={enviando}
                className="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm disabled:opacity-60"
              >
                {difiere ? 'Confirmar cambio y cerrar caso' : 'Confirmar sugerencia IA y cerrar caso'}
              </button>
              <button
                onClick={() => setDerivando(true)}
                disabled={enviando}
                className="px-4 py-3.5 rounded-xl border-2 border-red-300 text-red-700 font-bold hover:bg-red-50"
              >
                Derivar a evaluación médica
              </button>
            </div>
          )}

          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
