/**
 * Medidas derivadas (IMC, % de grasa, masa muscular, ICC) a partir de las medidas base. Las mismas ecuaciones
 * que aplica el servidor al guardar (DeportistasService._calcular_medidas_derivadas): la web y la estaciÃ³n
 * muestran lo mismo que queda guardado.
 */
export type SexoMedicion = '' | 'M' | 'F' | 'otro';
export type ClaveMedicionBase = 'peso' | 'cintura' | 'cadera' | 'pecho' | 'brazo' | 'pierna';
export interface MedidasDerivadas {
  grasaPct: number | null;
  clasificacionGrasa: string | null;
  masaMuscularKg: number | null;
  pctMuscular: number | null;
  masaGrasaKg: number | null;
  masaMagraKg: number | null;
  imc: number | null;
  clasificacionImc: string | null;
  icc: number | null;
  riesgoIcc: string | null;
}

/**
 * Calcula automáticamente las medidas corporales derivadas a partir de las medidas base,
 * diferenciando las ecuaciones antropométricas según el género (Hombre 'M' vs Mujer 'F').
 */
export function calcularMedidasDerivadas(
  medidas: Record<ClaveMedicionBase, string>,
  sexo: SexoMedicion,
  alturaCmStr: string,
  edadAnios: number | null
): MedidasDerivadas {
  const esMujer = sexo === 'F';
  const altNum = Number(alturaCmStr);
  // Sin sexo (M o F) y estatura reales no se calcula nada: un valor supuesto daría una medida inventada.
  if ((sexo !== 'M' && sexo !== 'F') || !(altNum > 0)) {
    return {
      grasaPct: null,
      clasificacionGrasa: null,
      masaMuscularKg: null,
      pctMuscular: null,
      masaGrasaKg: null,
      masaMagraKg: null,
      imc: null,
      clasificacionImc: null,
      icc: null,
      riesgoIcc: null,
    };
  }
  const alt = altNum;

  const num = (v: string): number | null => {
    if (!v || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const peso = num(medidas.peso);
  const cintura = num(medidas.cintura);
  const cadera = num(medidas.cadera);
  const brazo = num(medidas.brazo);
  const pierna = num(medidas.pierna);

  // 1. IMC y clasificación
  let imc: number | null = null;
  let clasificacionImc: string | null = null;
  if (peso && alt > 0) {
    const altM = alt / 100;
    imc = Math.round((peso / (altM * altM)) * 10) / 10;
    if (imc < 18.5) clasificacionImc = 'Bajo peso';
    else if (imc < 25) clasificacionImc = 'Normal';
    else if (imc < 30) clasificacionImc = 'Sobrepeso';
    else clasificacionImc = 'Obesidad';
  }

  // 2. % de Grasa Corporal diferenciado por género (Hombre vs Mujer)
  let rfmVal: number | null = null;
  let bmiVal: number | null = null;

  if (cintura && alt > 0) {
    if (esMujer) {
      let ajusteCadera = 0;
      if (cadera) {
        ajusteCadera = Math.max(-3, Math.min(4, 0.15 * (cadera - cintura - 15)));
      }
      rfmVal = 76 - 20 * (alt / cintura) + ajusteCadera;
    } else {
      rfmVal = 64 - 20 * (alt / cintura);
    }
  }

  // Esta ecuación necesita la edad: sin fecha de nacimiento no se supone ninguna.
  if (imc !== null && edadAnios !== null) {
    bmiVal = 1.2 * imc + 0.23 * edadAnios - (esMujer ? 5.4 : 16.2);
  }

  let grasaCalc: number | null = null;
  if (rfmVal !== null && bmiVal !== null) {
    grasaCalc = 0.6 * rfmVal + 0.4 * bmiVal;
  } else if (rfmVal !== null) {
    grasaCalc = rfmVal;
  } else if (bmiVal !== null) {
    grasaCalc = bmiVal;
  }

  let grasaPct: number | null = null;
  let clasificacionGrasa: string | null = null;
  if (grasaCalc !== null) {
    const [minG, maxG] = esMujer ? [10, 60] : [4, 55];
    grasaPct = Math.round(Math.max(minG, Math.min(maxG, grasaCalc)) * 10) / 10;
    if (esMujer) {
      if (grasaPct < 14) clasificacionGrasa = 'Esencial';
      else if (grasaPct < 21) clasificacionGrasa = 'Atlético';
      else if (grasaPct < 25) clasificacionGrasa = 'Fitness';
      else if (grasaPct < 32) clasificacionGrasa = 'Saludable';
      else clasificacionGrasa = 'Elevado';
    } else {
      if (grasaPct < 6) clasificacionGrasa = 'Esencial';
      else if (grasaPct < 14) clasificacionGrasa = 'Atlético';
      else if (grasaPct < 18) clasificacionGrasa = 'Fitness';
      else if (grasaPct < 25) clasificacionGrasa = 'Saludable';
      else clasificacionGrasa = 'Elevado';
    }
  }

  // 3. Masa Grasa, Masa Magra y Masa Muscular Esquelética diferenciada por género
  let masaGrasaKg: number | null = null;
  let masaMagraKg: number | null = null;
  let masaMuscularKg: number | null = null;
  let pctMuscular: number | null = null;

  if (peso !== null && grasaPct !== null) {
    masaGrasaKg = Math.round(peso * (grasaPct / 100) * 10) / 10;
    const magraRaw = peso * (1 - grasaPct / 100);
    masaMagraKg = Math.round(magraRaw * 10) / 10;

    let musculoCalc: number;
    if (esMujer) {
      let ajustePerim = 0;
      if (brazo) ajustePerim += (brazo - 27) * 0.06;
      if (pierna) ajustePerim += (pierna - 52) * 0.05;
      musculoCalc = magraRaw * 0.475 + ajustePerim;
    } else {
      let ajustePerim = 0;
      if (brazo) ajustePerim += (brazo - 32) * 0.08;
      if (pierna) ajustePerim += (pierna - 54) * 0.06;
      musculoCalc = magraRaw * 0.54 + ajustePerim;
    }

    const musculoClamped = Math.max(peso * 0.25, Math.min(magraRaw * 0.9, musculoCalc));
    masaMuscularKg = Math.round(musculoClamped * 10) / 10;
    pctMuscular = Math.round((masaMuscularKg / peso) * 1000) / 10;
  }

  // 4. Índice Cintura-Cadera (ICC) diferenciado por género
  let icc: number | null = null;
  let riesgoIcc: string | null = null;
  if (cintura && cadera) {
    icc = Math.round((cintura / cadera) * 100) / 100;
    if (esMujer) {
      if (icc < 0.8) riesgoIcc = 'Riesgo bajo';
      else if (icc <= 0.85) riesgoIcc = 'Riesgo moderado';
      else riesgoIcc = 'Riesgo alto';
    } else {
      if (icc < 0.9) riesgoIcc = 'Riesgo bajo';
      else if (icc <= 0.99) riesgoIcc = 'Riesgo moderado';
      else riesgoIcc = 'Riesgo alto';
    }
  }

  return {
    grasaPct,
    clasificacionGrasa,
    masaMuscularKg,
    pctMuscular,
    masaGrasaKg,
    masaMagraKg,
    imc,
    clasificacionImc,
    icc,
    riesgoIcc,
  };
}
