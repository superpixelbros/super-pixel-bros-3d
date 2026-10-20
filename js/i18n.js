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
  'controls.actions': 'ESC PAUSE  R RETRY  M SOUND  L LANG',
  'choose_hero': 'CHOOSE YOUR HERO',
  'select_hint': '← → SELECT      ENTER GO!',
  'select_hint_t': 'SWIPE SELECT      TAP GO!',
  'btn.play': 'PLAY',
  'spd': 'SPEED',
  'jmp': 'JUMP',
  'hud.coins': 'COINS {n}',
  'hud.time': 'TIME {t}',
  'hud.place': 'PLACE {p}/{m}',
  'paused': 'PAUSED',
  'pause_hint': 'ESC RESUME    R RETRY    Q TITLE',
  'pause.resume': 'RESUME',
  'pause.retry': 'RETRY',
  'pause.quit': 'TITLE',
  'clear.title': 'COURSE CLEAR!',
  'dq.title': 'DISQUALIFIED',
  'dq.sub': "TIME'S UP — reach the flag before the clock",
  'dq.retry': 'RETRY STAGE',
  'dq.hint': 'ENTER RETRY    Q TITLE',
  'lost.title': 'YOU LOST',
  'lost.rule_top3': 'FINISH TOP 3 OF 4 TO ADVANCE',
  'lost.rule_win': 'YOU MUST FINISH 1ST — NO SECOND CHANCE GIVEN',
  'lost.retry': 'RETRY STAGE',
  'lost.hint': 'ENTER RETRY    Q MAIN MENU',
  'clear.trophy': 'TROPHY UNLOCKED',
  'clear.time': 'TIME  {t}',
  'clear.coins': 'COINS  {n} / {m}',
  'clear.place': 'RACE PLACE  {p} / {m}',
  'clear.hint': 'ENTER FOR TITLE',
  'clear.hint_next': 'ENTER FOR NEXT ISLAND',
  'map.title': 'ADVENTURE MAP',
  'map.stage': 'STAGE {n} — {name}',
  'map.cleared': 'CLEARED ✓',
  'map.frontier': 'FRONTIER — RUN!',
  'map.hint': 'ENTER RUN    ◀ ▶ REPLAY    Q TITLE',
  'victory.title': 'ALL ISLANDS CLEARED!',
  'victory.sub': 'THE TROPHY IS YOURS',
  'victory.hint': 'ENTER FOR TITLE',
  'rotate': 'ROTATE TO LANDSCAPE',
  'hero.shararah.name': 'SHARARAH',
  'hero.shararah.blurb': 'A SPARK — LIGHTNING REFLEXES',
  'hero.yas.name': 'YAS',
  'hero.yas.blurb': 'MS CONFIDENT — NOTHING FAZES HER',
  'hero.ghzl.name': 'GHZL',
  'hero.ghzl.blurb': 'SILK SPINNER — BIG FLOATY JUMPS',
  'hero.duha.name': 'DUHA',
  'hero.duha.blurb': 'MORNING LIGHT — GLIDES ON AIR',
  'hero.wafaa.name': 'WAFAA',
  'hero.wafaa.blurb': 'LOYAL HEART — NEVER BREAKS FORM',
  'hero.faris.name': 'FARIS',
  'hero.faris.blurb': 'ARMORED KNIGHT — SURVIVES 3 HITS',
  'hero.dolar.name': 'DOLAR',
  'hero.dolar.blurb': 'THE HUSTLER — QUICK AND LEVEL-HEADED',
  'hero.hero.name': 'HERO',
  'hero.hero.blurb': 'EVERYMAN CHAMPION — GETS IT DONE',
  'hero.scoozy.name': 'SCOOZY',
  'hero.scoozy.blurb': 'ON WHEELS — SLIPPERY AND SHARP',
  'hero.glorious.name': 'GLORIOUS',
  'hero.glorious.blurb': 'THE SHOWOFF — 3 HEARTS OF PURE GOLD',
  'level.beach': 'SUNNY SHORE',
  'level.ridge': 'SUNSET RIDGE',
  'level.arena': 'BUMPER ARENA',
  'map.arena': 'CHALLENGE — SURVIVE 60s',
  'map.arenaHint': 'FREE CONTROL: WASD MOVE    SPACE JUMP    SHIFT SPIN',
  'hud.survive': 'SURVIVE {t}',
  'hud.wave': 'WAVE {n}',
  'over.title': 'SPLASH!',
  'over.sub': 'The ring closed and you went in',
  'over.time': 'SURVIVED  {t}',
  'over.best': 'BEST  {t}',
  'over.retry': 'TRY AGAIN',
  'over.hint': 'ENTER RETRY    Q MAIN MENU',
  'over.newbest': 'NEW BEST!',
  'win.title': 'LAST STANDING',
  'win.sub': '60 seconds in the ring — you outlasted it all',
  'win.locked': 'CLEAR ALL STAGES TO CLAIM THE TROPHY',
  'win.hint_trophy': 'ENTER FOR THE TROPHY',
  'win.hint_map': 'ENTER FOR THE MAP',
  'win.time': 'SURVIVED  {t}',
};

const AR = {
  'app.title': 'SUPER PIXEL BROS 3D',
  'tagline': 'اركض · دوّر · تعثّر',
  'press_enter': 'اضغط ENTER للبدء',
  'press_tap': 'انقر للبدء',
  'controls.move': 'تحرّك بالأسهم/WASD    اقفز بـ SPACE    دوّر بـ S',
  'controls.actions': 'ESC إيقاف  R إعادة  M صوت  L لغة',
  'choose_hero': 'اختر بطلك',
  'select_hint': '← → للاختيار      ENTER للبدء!',
  'select_hint_t': 'اسحب للاختيار      انقر للبدء!',
  'btn.play': 'ابدأ',
  'spd': 'سرعة',
  'jmp': 'قفز',
  'hud.coins': 'عملات {n}',
  'hud.time': 'وقت {t}',
  'hud.place': 'المركز {p}/{m}',
  'paused': 'إيقاف مؤقت',
  'pause_hint': 'ESC للمتابعة    R لإعادة    Q للخروج',
  'pause.resume': 'متابعة',
  'pause.retry': 'إعادة',
  'pause.quit': 'العنوان',
  'clear.title': 'أنهيت الملعب!',
  'dq.title': 'مُستبعد',
  'dq.sub': 'انتهى الوقت — ابلغ العلم قبل نفاد الوقت',
  'dq.retry': 'إعادة المرحلة',
  'dq.hint': 'ENTER للإعادة    Q للخروج',
  'lost.title': 'لقد خسرت',
  'lost.rule_top3': 'أنهِ ضمن المراكز الثلاثة الأولى للتقدّم',
  'lost.rule_win': 'يجب أن تنهي في المركز الأول',
  'lost.retry': 'إعادة المرحلة',
  'lost.hint': 'ENTER للإعادة    Q للقائمة الرئيسية',
  'clear.trophy': 'حصلت على الكأس',
  'clear.time': 'الوقت  {t}',
  'clear.coins': 'عملات  {n} / {m}',
  'clear.place': 'مركزك في السباق  {p} / {m}',
  'clear.hint': 'ENTER للعودة للعنوان',
  'clear.hint_next': 'ENTER للمرحلة التالية',
  'map.title': 'خريطة  المغامرة',
  'map.stage': 'المرحلة {n} — {name}',
  'map.cleared': 'أُنجزت ✓',
  'map.frontier': 'الجبهة — ابدأ!',
  'map.hint': 'ENTER للبدء    ◀ ▶ لإعادة اللعب    Q خروج',
  'victory.title': 'أنجزت كل الجزر!',
  'victory.sub': 'الكأس لك',
  'victory.hint': 'ENTER للعنوان',
  'rotate': 'أدر الشاشة أفقياً',
  'hero.shararah.name': 'شرارة',
  'hero.shararah.blurb': 'شرارة — ردود فعل خاطفة',
  'hero.yas.name': 'ياس',
  'hero.yas.blurb': 'واثقة النفس — لا شيء يهزّها',
  'hero.ghzl.name': 'غزل',
  'hero.ghzl.blurb': 'غزّالة — قفزات عالية ناعمة',
  'hero.duha.name': 'ضحى',
  'hero.duha.blurb': 'نور الصباح — انسياب في الهواء',
  'hero.wafaa.name': 'وفاء',
  'hero.wafaa.blurb': 'قلب وفيّ — لا يتخلّف عن الموعد',
  'hero.faris.name': 'فارس',
  'hero.faris.blurb': 'فارس مدرّع — يتحمّل 3 ضربات',
  'hero.dolar.name': 'دولار',
  'hero.dolar.blurb': 'المحتال — سريع وثاقب النظر',
  'hero.hero.name': 'هيرو',
  'hero.hero.blurb': 'بطل من العامة — ينهي المهمة',
  'hero.scoozy.name': 'سكوزي',
  'hero.scoozy.blurb': 'على عجلات — زلق وحاد',
  'hero.glorious.name': 'غلوريوس',
  'hero.glorious.blurb': 'المتباهي — 3 قلوب من ذهب',
  'level.beach': 'الشاطئ المشمس',
  'level.ridge': 'تلال الغروب',
  'level.arena': 'حلبة التصادم',
  'map.arena': 'تحدٍّ — اصمد 60 ثانية',
  'map.arenaHint': 'تحكم حر: WASD للحركة    SPACE للقفز    SHIFT للدوران',
  'hud.survive': 'اصمد {t}',
  'hud.wave': 'الموجة {n}',
  'over.title': 'هل سقطت!',
  'over.sub': 'أغلق الطوق وسقطت في الماء',
  'over.time': 'صمدت {t}',
  'over.best': 'أفضل وقت {t}',
  'over.retry': 'حاول مرة أخرى',
  'over.hint': 'ENTER للمحاولة    Q للقائمة الرئيسية',
  'over.newbest': 'رقم قياسي جديد!',
  'win.title': 'الناجي الأخير',
  'win.sub': '60 ثانية في الحلبة — لم يسقط أحد مثلك صمودًا',
  'win.locked': 'أنجز كل المراحل لنيل الكأس',
  'win.hint_trophy': 'ENTER لنيل الكأس',
  'win.hint_map': 'ENTER إلى الخريطة',
  'win.time': 'صمدت {t}',
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
