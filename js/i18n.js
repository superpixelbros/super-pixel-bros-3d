// Bilingual support: English (default) + Arabic. Toggle with L.
// The 3D game renders UI as crisp DOM panels, so Arabic shaping/RTL come
// for free from the browser — we just set <html lang/dir> and re-render.
// Numbers stay Western digits in both languages. Guarded so it imports
// clean under Node for the headless checks.

const LS_KEY = 'pixelbros3d_lang';
const hasDoc = typeof document !== 'undefined';
const hasLS = typeof localStorage !== 'undefined';

const EN = {
  'app.title': 'SUPER PIXEL BROS 3D',
  'tagline': 'RUN · SPIN · STUMBLE',
  'press_enter': 'PRESS ENTER TO START',
  'press_tap': 'TAP TO START',
  'controls.move': 'ARROWS/WASD MOVE    SPACE JUMP    S SPIN',
  'controls.actions': 'ESC PAUSE  R RETRY  L LANG',
  'choose_hero': 'CHOOSE YOUR HERO',
  'select_hint': '← → SELECT      ENTER GO!',
  'select_hint_t': 'SWIPE SELECT      TAP GO!',
  'btn.play': 'PLAY',
  'spd': 'SPEED',
  'jmp': 'JUMP',
  'hud.coins': 'COINS {n}',
  'hud.time': 'TIME {t}',
  'paused': 'PAUSED',
  'pause_hint': 'ESC RESUME    R RETRY    Q TITLE',
  'pause.resume': 'RESUME',
  'pause.retry': 'RETRY',
  'pause.quit': 'TITLE',
  'clear.title': 'COURSE CLEAR!',
  'clear.trophy': 'TROPHY UNLOCKED',
  'clear.time': 'TIME  {t}',
  'clear.coins': 'COINS  {n} / {m}',
  'clear.hint': 'ENTER FOR TITLE',
  'rotate': 'ROTATE TO LANDSCAPE',
  'hero.rosso.name': 'ROSSO',
  'hero.rosso.blurb': 'BALANCED — SURVIVES 1 EXTRA HIT',
  'hero.bolt.name': 'BOLT',
  'hero.bolt.blurb': 'SPEED DEMON — FRAGILE',
  'hero.aqua.name': 'AQUA',
  'hero.aqua.blurb': 'MEGA JUMP — FLOATY FALLS',
  'hero.faris.name': 'FARIS',
  'hero.faris.blurb': 'ARMORED KNIGHT — SURVIVES 3 HITS',
  'hero.sahm.name': 'SAHM',
  'hero.sahm.blurb': 'SUPER SPEED — SLIPPERY LOW JUMP',
  'level.beach': 'SUNNY SHORE',
};

const AR = {
  'app.title': 'SUPER PIXEL BROS 3D',
  'tagline': 'اركض · دوّر · تعثّر',
  'press_enter': 'اضغط ENTER للبدء',
  'press_tap': 'انقر للبدء',
  'controls.move': 'تحرّك بالأسهم/WASD    اقفز بـ SPACE    دوّر بـ S',
  'controls.actions': 'ESC إيقاف  R إعادة  L لغة',
  'choose_hero': 'اختر بطلك',
  'select_hint': '← → للاختيار      ENTER للبدء!',
  'select_hint_t': 'اسحب للاختيار      انقر للبدء!',
  'btn.play': 'ابدأ',
  'spd': 'سرعة',
  'jmp': 'قفز',
  'hud.coins': 'عملات {n}',
  'hud.time': 'وقت {t}',
  'paused': 'إيقاف مؤقت',
  'pause_hint': 'ESC للمتابعة    R لإعادة    Q للخروج',
  'pause.resume': 'متابعة',
  'pause.retry': 'إعادة',
  'pause.quit': 'العنوان',
  'clear.title': 'أنهيت الملعب!',
  'clear.trophy': 'حصلت على الكأس',
  'clear.time': 'الوقت  {t}',
  'clear.coins': 'عملات  {n} / {m}',
  'clear.hint': 'ENTER للعودة للعنوان',
  'rotate': 'أدر الشاشة أفقياً',
  'hero.rosso.name': 'روسو',
  'hero.rosso.blurb': 'متوازن — يتحمّل ضربة إضافية',
  'hero.bolt.name': 'بولت',
  'hero.bolt.blurb': 'شيطان السرعة — هشّ',
  'hero.aqua.name': 'أكوا',
  'hero.aqua.blurb': 'قفزة خارقة — سقوط ناعم',
  'hero.faris.name': 'فارس',
  'hero.faris.blurb': 'فارس مدرّع — يتحمّل ٣ ضربات',
  'hero.sahm.name': 'سهم',
  'hero.sahm.blurb': 'سرعة خارقة — قفزة منخفضة زلقة',
  'level.beach': 'الشاطئ المشمس',
};

let lang = (hasLS && localStorage.getItem(LS_KEY) === 'ar') ? 'ar' : 'en';
const listeners = [];

export function t(key, vars) {
  const table = lang === 'ar' ? AR : EN;
  let s = table[key];
  if (s === undefined) s = EN[key];
  if (s === undefined) return key;
  if (vars) for (const k of Object.keys(vars)) s = s.replaceAll('{'+k+'}', vars[k]);
  return s;
}

export function isArabic() { return lang === 'ar'; }

export function toggleLang() {
  lang = lang === 'ar' ? 'en' : 'ar';
  if (hasLS) localStorage.setItem(LS_KEY, lang);
  applyLang();
  for (const fn of listeners) fn(lang);
}

export function applyLang() {
  if (!hasDoc) return;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

export function onLangChange(fn) { listeners.push(fn); }

// exposed for the i18n parity check
export const TABLES = { en: EN, ar: AR };
