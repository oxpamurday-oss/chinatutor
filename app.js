(function () {
  "use strict";

  var COURSE = window.COURSE;
  var app = document.getElementById("app");
  var DAY = 86400000;
  // Leitner boxes: days until the next review for each box.
  var INTERVALS = [0, 1, 3, 7, 14, 30, 60, 120];

  // ---------- storage ----------
  var KEY = "hanyu-fic-v1";
  var state = load();
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    s = s || {};
    s.cards = s.cards || {};      // key -> { box, due }
    s.lessons = s.lessons || {};  // lessonId -> { best }
    s.settings = s.settings || { rate: 0.8, pinyin: true };
    if (!s.settings.fic) s.settings.fic = "2027-03-15";
    if (!s.started) s.started = today();
    s.mine = s.mine || [];        // user's own words: { h, p, r }
    return s;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  // ---------- helpers ----------
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pick(a, n, not) { return shuffle(a.filter(function (x) { return not.indexOf(x) < 0; })).slice(0, n); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

  var MARKS = { 1: "āēīōūǖĀĒĪŌŪ", 2: "áéíóúǘÁÉÍÓÚ", 3: "ǎěǐǒǔǚǍĚǏǑǓ", 4: "àèìòùǜÀÈÌÒÙ" };
  function toneOf(syl) {
    for (var t = 1; t <= 4; t++) for (var i = 0; i < syl.length; i++) if (MARKS[t].indexOf(syl[i]) >= 0) return t;
    return 5;
  }
  function isHan(ch) { return /[㐀-鿿]/.test(ch); }
  function pinyinHtml(p) {
    return p.split(" ").map(function (s) { return '<span class="t' + toneOf(s) + '">' + esc(s) + "</span>"; }).join(" ");
  }
  // Colour each hanzi by its syllable's tone when the counts line up.
  function hanziHtml(h, p) {
    var chars = Array.from(h), syl = p.split(" ");
    if (chars.filter(isHan).length !== syl.length) return esc(h);
    var k = 0;
    return chars.map(function (c) { return isHan(c) ? '<span class="t' + toneOf(syl[k++]) + '">' + esc(c) + "</span>" : esc(c); }).join("");
  }
  function cardKey(item) { return item.h; }
  function vocabItems() {
    var all = [];
    COURSE.forEach(function (l) { if (l.type === "vocab") l.items.forEach(function (it) { all.push(it); }); });
    return all.concat(state.mine);
  }

  // ---------- speech ----------
  var voice = null, voice2 = null;
  var hasSpeech = "speechSynthesis" in window;
  function findVoice() {
    if (!hasSpeech) return;
    var vs = speechSynthesis.getVoices();
    var cn = vs.filter(function (v) { return /^zh[-_]CN/i.test(v.lang); });
    if (!cn.length) cn = vs.filter(function (v) { return /^zh/i.test(v.lang); });
    voice = cn[0] || null;
    voice2 = cn[1] || voice;
    findRu();
  }
  if (hasSpeech) { findVoice(); speechSynthesis.onvoiceschanged = findVoice; }
  function utter(text, v) {
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    if (v) u.voice = v;
    u.rate = state.settings.rate;
    return u;
  }
  function say(text, alt) {
    if (!hasSpeech) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter(text, alt ? voice2 : voice));
  }
  // Queue every line of a dialogue; speaker B gets the second voice when the phone has one.
  function sayDialogue(lines) {
    if (!hasSpeech) return;
    speechSynthesis.cancel();
    lines.forEach(function (ln) { speechSynthesis.speak(utter(ln.h, ln.s === "B" ? voice2 : voice)); });
  }

  // ---------- SRS ----------
  function introduce(item) {
    var k = cardKey(item);
    if (!state.cards[k]) state.cards[k] = { box: 0, due: today() };
  }
  function grade(item, g) { // g: 0 forgot, 1 hard, 2 good
    var c = state.cards[cardKey(item)] || { box: 0, due: today() };
    if (g === 0) c.box = 0;
    else if (g === 2) c.box = Math.min(c.box + 1, INTERVALS.length - 1);
    else c.box = Math.max(c.box, 1);
    c.due = today() + INTERVALS[c.box] * DAY;
    state.cards[cardKey(item)] = c;
  }
  function dueItems() {
    var t = today();
    return vocabItems().filter(function (it) { var c = state.cards[cardKey(it)]; return c && c.due <= t; });
  }
  function learnedCount() {
    return vocabItems().filter(function (it) { var c = state.cards[cardKey(it)]; return c && c.box >= 1; }).length;
  }

  // ---------- screens ----------
  var screen = { name: "home" };
  function go(s) {
    if (screen.name === "audio") audioStop();
    if (recorder) recorder.stop();
    screen = s; render(); window.scrollTo(0, 0);
  }

  function render() {
    if (hasSpeech) speechSynthesis.cancel();
    var fn = { home: home, lesson: lesson, learn: learn, quiz: quiz, review: review, settings: settings,
               booth: booth, speak: speak, write: write, scan: scan, mine: mine, audio: audio }[screen.name];
    app.innerHTML = fn();
    if (screen.name === "write") mountWriter();
  }

  function home() {
    var due = dueItems().length, total = vocabItems().length, learned = learnedCount();
    var lastSection = null, list = "";
    COURSE.forEach(function (l, i) {
      var best = (state.lessons[l.id] || {}).best;
      var cls = best >= 80 ? "done" : best != null ? "started" : "";
      if (l.section !== lastSection) {
        if (lastSection !== null) list += "</ul>";
        list += '<div class="section-label">' + esc(l.section) + '</div><ul class="lessons">';
        lastSection = l.section;
      }
      list += '<li><button class="lesson ' + cls + '" data-go="lesson" data-id="' + l.id + '">' +
        '<span class="num">' + (i + 1) + '</span>' +
        '<span class="txt"><b>' + esc(l.title) + "</b><span>" + esc(l.hint) + "</span></span>" +
        (best != null ? '<span class="pct">' + best + "%</span>" : "") +
        "</button></li>";
    });
    list += "</ul>";
    return '<header class="top"><div class="brand"><span class="hz">汉语</span><small>к выставке FIC</small></div>' +
      '<button class="icon-btn" data-go="settings" aria-label="Настройки">⚙︎</button></header>' +
      voiceWarning() +
      '<section class="summary">' +
      '<div class="stat"><b>' + learned + " / " + total + "</b><span>слов выучено</span></div>" +
      '<div class="stat"><b>' + due + "</b><span>на повторение сегодня</span></div>" +
      '<button class="btn" data-go="review"' + (due ? "" : " disabled") + ">" +
      (due ? "Повторить " + due : "Сегодня повторять нечего") + "</button></section>" +
      planCard() + toolsGrid() + list +
      '<p class="note">Прогресс хранится на этом телефоне и работает без интернета.</p>';
  }

  // One lesson a week from the first launch; the rest of the week is review.
  function planCard() {
    var fic = new Date(state.settings.fic + "T00:00:00").getTime();
    var daysLeft = Math.max(0, Math.round((fic - today()) / DAY));
    var weeksTotal = Math.max(1, Math.ceil((fic - state.started) / (7 * DAY)));
    var week = Math.floor((today() - state.started) / (7 * DAY));
    var ahead = COURSE.find(function (l) { return !((state.lessons[l.id] || {}).best >= 80); });
    var due = COURSE[Math.min(Math.floor(week * COURSE.length / weeksTotal), COURSE.length - 1)];
    var behind = ahead && COURSE.indexOf(ahead) < COURSE.indexOf(due);
    var next = ahead
      ? '<button class="lesson-link" data-go="lesson" data-id="' + ahead.id + '">Следующий урок: <b>' + esc(ahead.title) + "</b></button>"
      : "<p>Все уроки пройдены. Повторяйте каждый день до выставки.</p>";
    return '<section class="plan"><div class="plan-head"><span class="section-label">До FIC</span><b>' + daysLeft + " " + plural(daysLeft, "день", "дня", "дней") + "</b></div>" +
      next +
      '<p class="note">' + (behind ? "По плану вы должны быть на уроке «" + esc(due.title) + "». Пройдите два урока на этой неделе."
                                   : "Вы идёте по плану: один урок в неделю и повторение каждый день.") + "</p></section>";
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function voiceWarning() {
    if (!hasSpeech) return '<p class="warn">Этот браузер не умеет озвучивать текст. Откройте приложение в Safari.</p>';
    if (!voice && speechSynthesis.getVoices().length) return '<p class="warn">Не найден китайский голос. На iPhone: Настройки → Универсальный доступ → Устный контент → Голоса → Китайский.</p>';
    return "";
  }

  function lessonById(id) { return COURSE.find(function (l) { return l.id === id; }); }

  function lesson() {
    var l = lessonById(screen.id);
    var items = l.items.map(function (it, i) {
      return '<button class="item" data-say="' + i + '"><span class="hz">' + hanziHtml(it.h, it.p) + "</span>" +
        (state.settings.pinyin ? '<span class="py">' + pinyinHtml(it.p) + "</span>" : "") +
        '<span class="ru">' + esc(it.r) + "</span></button>";
    }).join("");
    var learnBtn = l.type === "vocab" ? '<button class="btn ghost" data-go="learn" data-id="' + l.id + '">Карточки</button>' : "";
    return '<header class="top"><button class="icon-btn" data-go="home" aria-label="Назад">←</button><h2>' + esc(l.title) + "</h2></header>" +
      '<section class="theory">' + l.theory + "</section>" +
      dialogueHtml(l) +
      '<div class="row">' + learnBtn + '<button class="btn" data-go="quiz" data-id="' + l.id + '">Тест</button></div>' +
      '<div class="section-label">Нажмите, чтобы услышать</div><div class="items">' + items + "</div>";
  }

  function dialogueHtml(l) {
    if (!l.dialogue) return "";
    var lines = l.dialogue.map(function (ln, i) {
      return '<button class="line ' + (ln.s === "B" ? "b" : "a") + '" data-line="' + i + '"><span class="who">' + ln.s + "</span>" +
        '<span class="body"><span class="hz">' + esc(ln.h) + "</span>" +
        (state.settings.pinyin ? '<span class="py">' + pinyinHtml(ln.p) + "</span>" : "") +
        '<span class="ru">' + esc(ln.r) + "</span></span></button>";
    }).join("");
    return '<section class="dialogue"><div class="dialogue-head"><span class="section-label">Диалог</span>' +
      '<button class="speak" data-act="play-dialogue">▶ Весь диалог</button></div>' + lines + "</section>";
  }

  // Learn: flip through cards one by one; finishing adds them to review.
  function learn() {
    var l = lessonById(screen.id), i = screen.i || 0, it = l.items[i];
    var shown = screen.shown;
    return '<header class="top"><button class="icon-btn" data-go="lesson" data-id="' + l.id + '" aria-label="Назад">←</button><h2>' + esc(l.title) + "</h2></header>" +
      '<div class="progress"><i style="width:' + Math.round(100 * i / l.items.length) + '%"></i></div>' +
      '<div class="counter">' + (i + 1) + " из " + l.items.length + "</div>" +
      '<div class="card"><div class="hz">' + hanziHtml(it.h, it.p) + "</div>" +
      (shown ? '<div class="py">' + pinyinHtml(it.p) + '</div><div class="ru">' + esc(it.r) + "</div>"
             : '<p class="note">Попробуйте вспомнить перевод</p>') +
      '<button class="speak" data-speak="' + esc(it.h) + '">▶ Слушать</button></div>' +
      (shown ? '<button class="btn" data-act="next-card">' + (i + 1 < l.items.length ? "Дальше" : "Готово") + "</button>"
             : '<button class="btn" data-act="show-card">Показать</button>');
  }

  // Quiz: 10 multiple-choice questions built from the lesson.
  function buildQuiz(l) {
    var qs = [];
    var items = shuffle(l.items).slice(0, Math.min(10, l.items.length));
    items.forEach(function (it, n) {
      var others = l.items.filter(function (x) { return x !== it; });
      if (l.type === "tones") {
        qs.push({ kind: "tone", item: it, answer: toneOf(it.p), options: [1, 2, 3, 4] });
      } else if (l.type === "sounds") {
        var wrong = pick(others.map(function (x) { return x.p; }), 3, [it.p]);
        qs.push({ kind: "listen-py", item: it, answer: it.p, options: shuffle([it.p].concat(wrong)) });
      } else {
        var kinds = ["hz-ru", "ru-hz"];
        if (hasSpeech) kinds.push("listen-hz");
        var kind = kinds[n % kinds.length];
        var pool = others.length >= 3 ? others : others.concat(pick(vocabItems(), 3, [it].concat(others)));
        var opts = shuffle([it].concat(pick(pool, 3, [it])));
        qs.push({ kind: kind, item: it, answer: it.h, options: opts });
      }
    });
    return shuffle(qs);
  }

  function quiz() {
    var l = lessonById(screen.id);
    if (!screen.qs) { screen.qs = buildQuiz(l); screen.i = 0; screen.right = 0; }
    if (screen.i >= screen.qs.length) return quizResult(l);
    var q = screen.qs[screen.i], it = q.item, a = screen.answered;
    var prompt = "", opts = "";
    if (q.kind === "tone") {
      prompt = '<div class="q">Какой тон?</div>' + (a ? '<div class="hz">' + hanziHtml(it.h, it.p) + '</div><div class="py">' + pinyinHtml(it.p) + "</div>" : "");
      opts = q.options.map(function (t) { return optBtn(t, '<span class="t' + t + '">' + t + " тон</span>", q); }).join("");
    } else if (q.kind === "listen-py") {
      prompt = '<div class="q">Что вы слышите?</div>' + (a ? '<div class="hz">' + esc(it.h) + '</div><div class="ru">' + esc(it.r) + "</div>" : "");
      opts = q.options.map(function (p) { return optBtn(p, pinyinHtml(p), q); }).join("");
    } else if (q.kind === "hz-ru") {
      prompt = '<div class="hz">' + hanziHtml(it.h, it.p) + "</div>" + (state.settings.pinyin || a ? '<div class="py">' + pinyinHtml(it.p) + "</div>" : "");
      opts = q.options.map(function (o) { return optBtn(o.h, esc(o.r), q); }).join("");
    } else if (q.kind === "ru-hz") {
      prompt = '<div class="q">' + esc(it.r) + "</div>" + (a ? '<div class="py">' + pinyinHtml(it.p) + "</div>" : "");
      opts = q.options.map(function (o) { return optBtn(o.h, '<span class="hz">' + esc(o.h) + "</span>", q); }).join("");
    } else {
      prompt = '<div class="q">Что вы слышите?</div>' + (a ? '<div class="py">' + pinyinHtml(it.p) + '</div><div class="ru">' + esc(it.r) + "</div>" : "");
      opts = q.options.map(function (o) { return optBtn(o.h, '<span class="hz">' + esc(o.h) + "</span>", q); }).join("");
    }
    var listen = q.kind === "tone" || q.kind === "listen-py" || q.kind === "listen-hz" || a;
    var fb = a ? (screen.lastRight ? '<div class="feedback good">Верно</div>' : '<div class="feedback bad">Неверно</div>') : '<div class="feedback"></div>';
    return '<header class="top"><button class="icon-btn" data-go="lesson" data-id="' + l.id + '" aria-label="Выйти">✕</button><h2>' + esc(l.title) + "</h2></header>" +
      '<div class="progress"><i style="width:' + Math.round(100 * screen.i / screen.qs.length) + '%"></i></div>' +
      '<div class="card">' + prompt + (listen ? '<button class="speak" data-speak="' + esc(it.h) + '">▶ Слушать</button>' : "") + "</div>" +
      fb + '<div class="choices">' + opts + "</div>" +
      (a ? '<button class="btn" data-act="next-q">Дальше</button>' : "");
  }
  function optBtn(value, label, q) {
    var cls = "choice";
    if (screen.answered) {
      if (String(value) === String(q.answer)) cls += " right";
      else if (String(value) === String(screen.picked)) cls += " wrong";
    }
    return '<button class="' + cls + '" data-pick="' + esc(value) + '"' + (screen.answered ? " disabled" : "") + ">" + label + "</button>";
  }
  function quizResult(l) {
    var pct = Math.round(100 * screen.right / screen.qs.length);
    var rec = state.lessons[l.id] || {};
    if (rec.best == null || pct > rec.best) rec.best = pct;
    state.lessons[l.id] = rec; save();
    var msg = pct >= 80 ? "Отлично, урок пройден." : "Для зачёта нужно 80%. Повторите карточки и попробуйте ещё раз.";
    return '<header class="top"><button class="icon-btn" data-go="home" aria-label="Домой">←</button><h2>' + esc(l.title) + "</h2></header>" +
      '<div class="card"><div class="q">' + screen.right + " из " + screen.qs.length + '</div><div class="ru">' + msg + "</div></div>" +
      '<div class="row"><button class="btn ghost" data-go="quiz" data-id="' + l.id + '">Ещё раз</button><button class="btn" data-go="home">К урокам</button></div>';
  }

  function review() {
    if (!screen.queue) screen.queue = shuffle(dueItems());
    if (!screen.queue.length) {
      return '<header class="top"><button class="icon-btn" data-go="home" aria-label="Домой">←</button><h2>Повторение</h2></header>' +
        '<div class="card"><div class="q">Всё повторено</div><div class="ru">Следующие карточки появятся завтра.</div></div>' +
        '<button class="btn" data-go="home">К урокам</button>';
    }
    var it = screen.queue[0], shown = screen.shown;
    return '<header class="top"><button class="icon-btn" data-go="home" aria-label="Домой">←</button><h2>Повторение</h2></header>' +
      '<div class="counter">Осталось ' + screen.queue.length + "</div>" +
      '<div class="card"><div class="hz">' + hanziHtml(it.h, it.p) + "</div>" +
      (shown ? '<div class="py">' + pinyinHtml(it.p) + '</div><div class="ru">' + esc(it.r) + "</div>" : '<p class="note">Вспомните звучание и перевод</p>') +
      '<button class="speak" data-speak="' + esc(it.h) + '">▶ Слушать</button></div>' +
      (shown ? '<div class="grade"><button class="g0" data-grade="0">Забыл<small>сегодня ещё</small></button>' +
               '<button class="g1" data-grade="1">Трудно<small>завтра</small></button>' +
               '<button class="g2" data-grade="2">Помню<small>позже</small></button></div>'
             : '<button class="btn" data-act="show-review">Показать ответ</button>');
  }

  function settings() {
    var r = state.settings.rate;
    function seg(v, label) { return '<button class="' + (r === v ? "on" : "") + '" data-rate="' + v + '">' + label + "</button>"; }
    return '<header class="top"><button class="icon-btn" data-go="home" aria-label="Назад">←</button><h2>Настройки</h2></header>' +
      '<div class="settings">' +
      '<div class="setting"><b>Скорость речи</b><div class="seg">' + seg(0.6, "Медленно") + seg(0.8, "Обычно") + seg(1, "Быстро") + "</div>" +
      '<button class="speak" data-speak="你好，很高兴认识你">▶ Проверить голос</button></div>' +
      '<div class="setting"><b>Пиньинь в карточках и тестах</b><div class="seg">' +
      '<button class="' + (state.settings.pinyin ? "on" : "") + '" data-pinyin="1">Показывать</button>' +
      '<button class="' + (!state.settings.pinyin ? "on" : "") + '" data-pinyin="0">Скрывать</button></div>' +
      '<p class="note">Скрывайте, когда начнёте узнавать иероглифы. Так быстрее учится чтение.</p></div>' +
      '<div class="setting"><label for="fic-date"><b>Дата выставки FIC</b></label>' +
      '<input id="fic-date" type="date" value="' + esc(state.settings.fic) + '">' +
      '<p class="note">По ней считается план и отсчёт на главном экране.</p></div>' +
      '<div class="setting"><b>Прогресс</b><p class="note">Выучено слов: ' + learnedCount() + '.</p>' +
      (screen.confirm ? '<div class="row"><button class="btn ghost" data-act="reset-no">Отмена</button><button class="btn" data-act="reset-yes">Да, стереть</button></div>'
                      : '<button class="btn ghost" data-act="reset">Сбросить прогресс</button>') + "</div></div>";
  }

  // ---------- tools ----------
  var TOOLS = [
    { id: "booth", title: "На стенде", hint: "Крупные фразы для собеседника" },
    { id: "speak", title: "Произношение", hint: "Скажите в микрофон" },
    { id: "write", title: "Прописи", hint: "Порядок черт пальцем" },
    { id: "scan", title: "Разбор текста", hint: "Этикетка, спецификация" },
    { id: "mine", title: "Мой словарь", hint: "Свои слова и термины" },
    { id: "audio", title: "Аудио", hint: "Слушать без экрана" }
  ];
  function toolsGrid() {
    return '<div class="section-label">Инструменты</div><div class="tools">' + TOOLS.map(function (t) {
      return '<button class="tool" data-go="' + t.id + '"><b>' + t.title + "</b><span>" + t.hint + "</span></button>";
    }).join("") + "</div>";
  }
  function backBar(title) {
    return '<header class="top"><button class="icon-btn" data-go="home" aria-label="Назад">←</button><h2>' + esc(title) + "</h2></header>";
  }
  function lessonOptions(selected, withMine) {
    var opts = COURSE.filter(function (l) { return l.type === "vocab"; }).map(function (l) {
      return '<option value="' + l.id + '"' + (l.id === selected ? " selected" : "") + ">" + esc(l.title) + "</option>";
    });
    if (withMine && state.mine.length) opts.unshift('<option value="mine"' + (selected === "mine" ? " selected" : "") + ">Мой словарь</option>");
    return opts.join("");
  }
  function itemsOf(id) {
    if (id === "mine") return state.mine.slice();
    var l = lessonById(id);
    return l ? l.items.concat(l.dialogue || []) : [];
  }

  // Booth: phrase list, tap to show a phrase full screen to the other person.
  function booth() {
    if (screen.show) {
      var it = screen.show;
      return '<div class="show"><button class="icon-btn show-close" data-act="booth-close" aria-label="Закрыть">✕</button>' +
        '<div class="show-hz hz">' + esc(it.h) + "</div>" +
        '<div class="show-py">' + pinyinHtml(it.p) + "</div>" +
        '<div class="show-ru">' + esc(it.r) + "</div>" +
        '<button class="btn" data-speak="' + esc(it.h) + '">▶ Сказать вслух</button></div>';
    }
    var unit = screen.unit || "";
    function unitBtn(u, label) { return '<button class="' + (unit === u ? "on" : "") + '" data-unit="' + u + '">' + label + "</button>"; }
    var num = numberCard(screen.num || "", unit);
    var groups = window.BOOTH.map(function (g, gi) {
      return '<div class="section-label">' + esc(g.title) + "</div>" + g.items.map(function (it, i) {
        return '<button class="phrase" data-show="' + gi + ":" + i + '"><span class="ru-main">' + esc(it.r) + '</span><span class="hz">' + esc(it.h) + "</span></button>";
      }).join("");
    }).join("");
    return backBar("На стенде") +
      '<p class="note">Нажмите на фразу, чтобы показать её собеседнику крупно или произнести.</p>' +
      '<section class="setting"><label for="num-input"><b>Число или цена по-китайски</b></label>' +
      '<input id="num-input" inputmode="decimal" placeholder="Например, 25000 или 0.3" value="' + esc(screen.num || "") + '">' +
      '<div class="seg">' + unitBtn("", "—") + unitBtn("美元", "$") + unitBtn("元", "¥") + unitBtn("公斤", "кг") + unitBtn("吨", "т") + "</div>" +
      '<div id="num-out">' + num + "</div></section>" + groups;
  }
  var DIG = "零一二三四五六七八九";
  var NUM_PY = { "零": "líng", "一": "yī", "二": "èr", "两": "liǎng", "三": "sān", "四": "sì", "五": "wǔ", "六": "liù", "七": "qī", "八": "bā", "九": "jiǔ", "十": "shí", "百": "bǎi", "千": "qiān", "万": "wàn", "点": "diǎn", "美": "Měi", "元": "yuán", "公": "gōng", "斤": "jīn", "吨": "dūn", "亿": "yì" };
  function fourZh(x, leading) {
    var units = ["千", "百", "十", ""], d = [Math.floor(x / 1000), Math.floor(x / 100) % 10, Math.floor(x / 10) % 10, x % 10];
    var out = "", zero = false;
    for (var i = 0; i < 4; i++) {
      if (d[i] === 0) { if (out) zero = true; continue; }
      if (zero) { out += "零"; zero = false; }
      var ch = d[i] === 2 && i < 2 ? "两" : DIG[d[i]];
      if (i === 2 && d[i] === 1 && !out && leading) ch = "";
      out += ch + units[i];
    }
    return out;
  }
  function intZh(n) {
    if (n === 0) return "零";
    var hi = Math.floor(n / 10000), lo = n % 10000;
    if (!hi) return fourZh(lo, true);
    var h = fourZh(hi, true);
    if (h === "二") h = "两";
    var s = h + "万";
    if (lo) s += (lo < 1000 || hi % 10 === 0 ? "零" : "") + fourZh(lo, false);
    return s;
  }
  function numberZh(str) {
    var m = String(str).replace(/\s/g, "").replace(",", ".").match(/^(\d{1,8})(?:\.(\d{1,4}))?$/);
    if (!m) return null;
    var s = intZh(parseInt(m[1], 10));
    if (m[2]) s += "点" + m[2].split("").map(function (c) { return DIG[+c]; }).join("");
    return s;
  }
  function numberCard(str, unit) {
    if (!str) return "";
    var zh = numberZh(str);
    if (!zh) return '<p class="note">Введите число до 99 999 999, можно с дробью: 0.3</p>';
    if (zh === "二" && unit) zh = "两";
    zh += unit;
    var py = Array.from(zh).map(function (c) { return NUM_PY[c] || ""; }).join(" ");
    var it = { h: zh, p: py, r: str + (unit ? " " + { "美元": "долл.", "元": "юаней", "公斤": "кг", "吨": "т" }[unit] : "") };
    screen.numItem = it;
    return '<button class="phrase big" data-act="num-show"><span class="hz">' + esc(zh) + '</span><span class="py">' + pinyinHtml(py) + "</span></button>";
  }

  // Pronunciation: speech recognition where the phone offers it, plus record and compare.
  var Recog = window.SpeechRecognition || window.webkitSpeechRecognition;
  function speak() {
    var src = screen.src || firstStudied();
    var items = itemsOf(src);
    if (screen.i == null || screen.i >= items.length) screen.i = 0;
    var it = items[screen.i];
    var res = screen.result || "";
    return backBar("Произношение") +
      '<label class="sr" for="src-select">Урок</label><select id="src-select" class="select">' + lessonOptions(src, true) + "</select>" +
      '<div class="counter">' + (screen.i + 1) + " из " + items.length + "</div>" +
      '<div class="card"><div class="hz">' + hanziHtml(it.h, it.p) + '</div><div class="py">' + pinyinHtml(it.p) + '</div><div class="ru">' + esc(it.r) + "</div>" +
      '<button class="speak" data-speak="' + esc(it.h) + '">▶ Образец</button></div>' +
      '<div class="feedback-box">' + res + "</div>" +
      '<div class="row">' +
      (Recog ? '<button class="btn" data-act="recognize">' + (screen.listening ? "Слушаю…" : "Сказать и проверить") + "</button>" : "") +
      '<button class="btn ghost" data-act="record">' + (screen.recording ? "■ Остановить запись" : "● Записать себя") + "</button></div>" +
      (screen.recUrl ? '<div class="row"><button class="btn ghost" data-act="play-rec">▶ Моя запись</button><button class="btn ghost" data-speak="' + esc(it.h) + '">▶ Образец</button></div>' : "") +
      '<button class="btn ghost" data-act="speak-next">Следующая фраза</button>' +
      (Recog ? '<p class="note">Проверка распознаёт речь через сервис Apple, для неё нужен интернет. Если распознались ваши иероглифы, тоны были верными.</p>'
             : '<p class="note">Автопроверка на этом устройстве недоступна. Запишите себя и сравните с образцом на слух.</p>');
  }
  function firstStudied() {
    var l = COURSE.find(function (l) { return l.type === "vocab" && !((state.lessons[l.id] || {}).best >= 80); });
    return (l || COURSE.find(function (l) { return l.type === "vocab"; })).id;
  }
  function plain(s) { return Array.from(s).filter(isHan).join(""); }
  function startRecognition() {
    var it = itemsOf(screen.src || firstStudied())[screen.i];
    var r = new Recog();
    r.lang = "zh-CN"; r.interimResults = false; r.maxAlternatives = 3;
    screen.listening = true; screen.result = ""; render();
    r.onresult = function (e) {
      var target = plain(it.h), best = "", score = -1;
      for (var k = 0; k < e.results[0].length; k++) {
        var heard = plain(e.results[0][k].transcript);
        var sc = Array.from(target).filter(function (c) { return heard.indexOf(c) >= 0; }).length;
        if (sc > score) { score = sc; best = heard; }
      }
      var marks = Array.from(target).map(function (c) { return '<span class="' + (best.indexOf(c) >= 0 ? "ok" : "miss") + '">' + c + "</span>"; }).join("");
      var all = score === target.length;
      screen.result = '<div class="feedback ' + (all ? "good" : "bad") + '">' + (all ? "Отлично, всё понятно" : "Не все слоги распознаны") + "</div>" +
        '<div class="marks hz">' + marks + '</div><p class="note">Распознано: ' + esc(best || "ничего") + "</p>";
    };
    r.onerror = function (e) {
      screen.result = '<p class="note">Не получилось распознать (' + esc(e.error) + "). Проверьте интернет и доступ к микрофону.</p>";
    };
    r.onend = function () { screen.listening = false; if (screen.name === "speak") render(); };
    try { r.start(); } catch (e) { screen.listening = false; render(); }
  }
  var recorder = null, recStream = null;
  function toggleRecord() {
    if (recorder) { recorder.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      screen.result = '<p class="note">Запись звука здесь недоступна.</p>'; render(); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recStream = stream;
      var chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = function (e) { chunks.push(e.data); };
      recorder.onstop = function () {
        if (screen.recUrl) URL.revokeObjectURL(screen.recUrl);
        screen.recUrl = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
        recStream.getTracks().forEach(function (t) { t.stop(); });
        recorder = null; screen.recording = false; render();
      };
      recorder.start(); screen.recording = true; render();
    }).catch(function () {
      screen.result = '<p class="note">Нет доступа к микрофону. Разрешите его в настройках iPhone для Safari.</p>'; render();
    });
  }

  // Writing: Hanzi Writer with stroke data bundled in strokes.json.
  var strokes = null;
  function loadStrokes() {
    if (strokes) return Promise.resolve(strokes);
    return fetch("strokes.json").then(function (r) { return r.json(); }).then(function (d) { strokes = d; return d; });
  }
  function writeChars(src) {
    var seen = {}, out = [];
    itemsOf(src).forEach(function (it) { Array.from(it.h).forEach(function (c) { if (isHan(c) && !seen[c]) { seen[c] = 1; out.push(c); } }); });
    return out;
  }
  function write() {
    var src = screen.src || firstStudied();
    var chars = writeChars(src);
    if (screen.i == null || screen.i >= chars.length) screen.i = 0;
    var c = chars[screen.i];
    var word = itemsOf(src).find(function (it) { return it.h.indexOf(c) >= 0; });
    return backBar("Прописи") +
      '<label class="sr" for="src-select">Урок</label><select id="src-select" class="select">' + lessonOptions(src, true) + "</select>" +
      '<div class="counter">' + (screen.i + 1) + " из " + chars.length + " · из слова «" + esc(word.r) + "» " + esc(word.h) + "</div>" +
      '<div class="writer-wrap"><div id="writer" class="writer"></div></div>' +
      '<div class="feedback-box" id="write-msg"><p class="note">Обведите иероглиф пальцем по порядку черт.</p></div>' +
      '<div class="row"><button class="btn ghost" data-act="write-demo">Показать порядок</button><button class="btn ghost" data-act="write-again">Заново</button></div>' +
      '<div class="row"><button class="btn ghost" data-act="write-prev">← Назад</button><button class="btn" data-act="write-next">Следующий →</button></div>';
  }
  var writer = null;
  function mountWriter() {
    var src = screen.src || firstStudied(), c = writeChars(src)[screen.i];
    var box = document.getElementById("writer");
    if (!window.HanziWriter) { box.innerHTML = '<p class="note">Модуль прописей не загрузился.</p>'; return; }
    var size = Math.min(box.clientWidth || 300, 320);
    var cs = getComputedStyle(document.documentElement);
    loadStrokes().then(function (data) {
      if (data[c]) return data;
      // Characters outside the course come from per-character files (need internet the first time).
      return fetch("strokes/" + encodeURIComponent(c) + ".json").then(function (r) {
        if (!r.ok) throw new Error("missing");
        return r.json();
      }).then(function (one) { data[c] = one; return data; });
    }).then(function (data) {
      box.innerHTML = "";
      writer = HanziWriter.create(box, c, {
        width: size, height: size, padding: 12, showOutline: true, showCharacter: false,
        strokeColor: cs.getPropertyValue("--ink").trim() || "#17201c",
        outlineColor: cs.getPropertyValue("--line").trim() || "#d9e0db",
        drawingColor: cs.getPropertyValue("--accent").trim() || "#1f6f55",
        highlightColor: cs.getPropertyValue("--t2").trim() || "#d17a00",
        charDataLoader: function (ch, done) { done(data[ch]); }
      });
      startQuiz();
    }).catch(function () { box.innerHTML = '<p class="note">Для «' + esc(c) + '» нет данных порядка черт, или нужен интернет, чтобы загрузить их в первый раз.</p>'; });
  }
  function startQuiz() {
    if (!writer) return;
    writer.quiz({
      onComplete: function (s) {
        var msg = document.getElementById("write-msg");
        if (msg) msg.innerHTML = '<div class="feedback ' + (s.totalMistakes ? "bad" : "good") + '">' +
          (s.totalMistakes ? "Готово, ошибок: " + s.totalMistakes : "Без ошибок!") + "</div>";
      }
    });
  }

  // Text analysis: paste text (for example via Live Text from a photo) and split it into known words.
  function dictionary() {
    var d = {};
    vocabItems().forEach(function (it) { d[plain(it.h)] = it; });
    COURSE.forEach(function (l) { if (l.type !== "vocab") l.items.forEach(function (it) { if (!d[it.h]) d[it.h] = it; }); });
    return d;
  }
  function segment(text) {
    var d = dictionary(), maxLen = 8, out = [], chars = Array.from(text), i = 0;
    while (i < chars.length) {
      if (!isHan(chars[i])) { out.push({ t: chars[i] }); i++; continue; }
      var hit = null;
      for (var n = Math.min(maxLen, chars.length - i); n > 0; n--) {
        var w = chars.slice(i, i + n).join("");
        if (d[w]) { hit = { t: w, it: d[w] }; break; }
      }
      if (hit) { out.push(hit); i += Array.from(hit.t).length; } else { out.push({ t: chars[i], unknown: true }); i++; }
    }
    return out;
  }
  function scan() {
    var text = screen.text || "";
    var segs = text ? segment(text) : [];
    var known = segs.filter(function (s) { return s.it; }), han = segs.filter(function (s) { return s.it || s.unknown; });
    var body = segs.map(function (s, k) {
      if (s.it) return '<button class="tok known" data-tok="' + k + '"><span class="hz">' + esc(s.t) + '</span><span class="tok-ru">' + esc(s.it.r) + "</span></button>";
      if (s.unknown) return '<span class="tok unknown hz">' + esc(s.t) + "</span>";
      return s.t === "\n" ? "<br>" : '<span class="tok sep">' + esc(s.t) + "</span>";
    }).join("");
    screen.segs = segs;
    var unknownChars = segs.filter(function (s) { return s.unknown; }).map(function (s) { return s.t; });
    return backBar("Разбор текста") +
      '<p class="note">Сфотографируйте этикетку, откройте фото, нажмите значок выделения текста в углу, скопируйте текст и вставьте сюда. Так же можно навести камеру прямо на упаковку.</p>' +
      '<label class="sr" for="scan-input">Текст</label><textarea id="scan-input" class="textarea" rows="4" placeholder="配料表：猪肉、淀粉、大豆蛋白…">' + esc(text) + "</textarea>" +
      '<div class="row"><button class="btn" data-act="scan-go">Разобрать</button><button class="btn ghost" data-act="scan-sample">Пример этикетки</button></div>' +
      (text ? '<p class="note">Знакомых слов: ' + known.length + " из " + han.length + ". Нажмите на слово, чтобы услышать.</p>" +
              '<div class="scan-out">' + body + "</div>" +
              (unknownChars.length ? '<button class="btn ghost" data-act="scan-add">Добавить незнакомое в мой словарь</button>' : "")
            : "");
  }
  var SAMPLE_LABEL = "产品名称：烟熏火腿\n配料表：猪肉、水、淀粉、大豆蛋白、白砂糖、食用盐、卡拉胶、磷酸盐、亚硝酸钠、食用香精\n净含量：500克\n储存条件：冷藏\n保质期：90天\n生产日期：见包装";

  // My dictionary: user words go into review like lesson words.
  function charPinyin() {
    var map = {};
    COURSE.forEach(function (l) {
      l.items.concat(l.dialogue || []).forEach(function (it) {
        var han = Array.from(it.h).filter(isHan), syl = it.p.split(" ");
        if (han.length !== syl.length) return;
        han.forEach(function (c, k) { if (!map[c]) map[c] = syl[k].replace(/[^a-zA-Züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g, "").toLowerCase(); });
      });
    });
    return map;
  }
  function guessPinyin(h) {
    var map = charPinyin(), han = Array.from(h).filter(isHan);
    if (!han.length || !han.every(function (c) { return map[c]; })) return "";
    return han.map(function (c) { return map[c]; }).join(" ");
  }
  function mine() {
    var f = screen.form || { h: "", p: "", r: "" };
    var list = state.mine.map(function (it, i) {
      return '<div class="mine-row"><button class="item" data-speak="' + esc(it.h) + '"><span class="hz">' + hanziHtml(it.h, it.p) + "</span>" +
        (it.p ? '<span class="py">' + pinyinHtml(it.p) + "</span>" : "") + '<span class="ru">' + esc(it.r) + "</span></button>" +
        '<button class="icon-btn" data-del="' + i + '" aria-label="Удалить">✕</button></div>';
    }).join("");
    return backBar("Мой словарь") +
      '<section class="setting"><b>Новое слово</b>' +
      '<label for="mine-h" class="note">Иероглифы</label><input id="mine-h" class="field hz" value="' + esc(f.h) + '" placeholder="复合磷酸盐">' +
      '<label for="mine-p" class="note">Пиньинь, через пробел по слогам</label><input id="mine-p" class="field" value="' + esc(f.p) + '" placeholder="fù hé lín suān yán" autocapitalize="off">' +
      '<label for="mine-r" class="note">Перевод</label><input id="mine-r" class="field" value="' + esc(f.r) + '" placeholder="Комплексные фосфаты">' +
      (screen.formMsg ? '<p class="note">' + screen.formMsg + "</p>" : "") +
      '<button class="btn" data-act="mine-save">Сохранить</button>' +
      '<p class="note">Пиньинь подставится сам, если все иероглифы уже встречались в уроках. Тоны можно набрать на клавиатуре iPhone «Китайская, пиньинь» или оставить пустым.</p></section>' +
      (state.mine.length ? '<div class="section-label">Слов: ' + state.mine.length + '</div><div class="mine-list">' + list + "</div>"
                         : '<p class="note">Пока пусто. Добавленные слова попадут в ежедневное повторение, в тренажёр произношения, прописи и разбор текста.</p>');
  }
  function readForm() {
    function v(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }
    return { h: v("mine-h"), p: v("mine-p"), r: v("mine-r") };
  }

  // Audio: Chinese, pause, Russian, Chinese again. Keeps the screen awake while it plays.
  var ruVoice = null, audioTimer = null, wakeLock = null;
  function findRu() {
    if (!hasSpeech) return;
    ruVoice = speechSynthesis.getVoices().find(function (v) { return /^ru/i.test(v.lang); }) || null;
  }
  function audio() {
    var src = screen.src || firstStudied(), items = itemsOf(src);
    if (screen.i == null || screen.i >= items.length) screen.i = 0;
    var it = items[screen.i];
    return backBar("Аудио") +
      '<label class="sr" for="src-select">Урок</label><select id="src-select" class="select">' + lessonOptions(src, true) + "</select>" +
      '<div class="counter">' + (screen.i + 1) + " из " + items.length + "</div>" +
      '<div class="card"><div class="hz">' + hanziHtml(it.h, it.p) + '</div><div class="py">' + pinyinHtml(it.p) + '</div><div class="ru">' + esc(it.r) + "</div></div>" +
      '<div class="row"><button class="btn ghost" data-act="audio-prev">←</button>' +
      '<button class="btn" data-act="audio-toggle">' + (screen.playing ? "❚❚ Пауза" : "▶ Слушать урок") + '</button>' +
      '<button class="btn ghost" data-act="audio-next">→</button></div>' +
      '<p class="note">Порядок: китайский, пауза, чтобы повторить вслух, перевод, снова китайский. Экран не гаснет, пока идёт урок. Если заблокировать телефон, iPhone остановит озвучку.</p>';
  }
  function audioStep() {
    if (!screen.playing || screen.name !== "audio") return;
    var items = itemsOf(screen.src || firstStudied()), it = items[screen.i];
    var seq = [utter(it.h, voice)];
    var ru = new SpeechSynthesisUtterance(it.r); ru.lang = "ru-RU"; if (ruVoice) ru.voice = ruVoice; ru.rate = 1;
    seq.push(ru, utter(it.h, voice));
    var k = 0;
    function next() {
      if (!screen.playing || screen.name !== "audio") return;
      if (k >= seq.length) {
        audioTimer = setTimeout(function () {
          screen.i = (screen.i + 1) % items.length; render(); audioStep();
        }, 1200);
        return;
      }
      var u = seq[k++];
      u.onend = function () { audioTimer = setTimeout(next, k === 1 ? 1800 : 700); };
      speechSynthesis.speak(u);
    }
    next();
  }
  function audioStop() {
    screen.playing = false;
    clearTimeout(audioTimer);
    if (hasSpeech) speechSynthesis.cancel();
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  }
  function audioStart() {
    if (!hasSpeech) return;
    screen.playing = true; render();
    if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (l) { wakeLock = l; }).catch(function () {});
    audioStep();
  }

  // ---------- events ----------
  app.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var d = b.dataset;
    if (d.go) { var s = { name: d.go }; if (d.id) s.id = d.id; go(s); return; }
    if (d.say != null) { say(lessonById(screen.id).items[+d.say].h); return; }
    if (d.speak) { say(d.speak); return; }
    if (d.show) { var gi = d.show.split(":"); screen.show = window.BOOTH[+gi[0]].items[+gi[1]]; render(); window.scrollTo(0, 0); return; }
    if (d.unit != null) { screen.unit = d.unit; render(); return; }
    if (d.tok != null) { say(screen.segs[+d.tok].t); return; }
    if (d.del != null) { state.mine.splice(+d.del, 1); save(); render(); return; }
    if (d.line != null) { var ln = lessonById(screen.id).dialogue[+d.line]; say(ln.h, ln.s === "B"); return; }
    if (d.pick != null) {
      var q = screen.qs[screen.i];
      screen.answered = true; screen.picked = d.pick;
      screen.lastRight = String(d.pick) === String(q.answer);
      if (screen.lastRight) screen.right++;
      var l = lessonById(screen.id);
      if (l.type === "vocab") { introduce(q.item); grade(q.item, screen.lastRight ? 2 : 0); save(); }
      render(); say(q.item.h); return;
    }
    if (d.grade != null) {
      var it = screen.queue.shift(), g = +d.grade;
      grade(it, g); save();
      if (g === 0) screen.queue.push(it);
      screen.shown = false; render(); return;
    }
    if (d.rate) { state.settings.rate = +d.rate; save(); render(); return; }
    if (d.pinyin) { state.settings.pinyin = d.pinyin === "1"; save(); render(); return; }
    switch (d.act) {
      case "show-card": screen.shown = true; render(); say(lessonById(screen.id).items[screen.i || 0].h); break;
      case "next-card": {
        var lc = lessonById(screen.id), i = screen.i || 0;
        introduce(lc.items[i]); save();
        if (i + 1 < lc.items.length) { screen.i = i + 1; screen.shown = false; render(); }
        else go({ name: "lesson", id: lc.id });
        break;
      }
      case "next-q": screen.i++; screen.answered = false; render(); autoPlay(); break;
      case "booth-close": screen.show = null; render(); break;
      case "num-show": screen.show = screen.numItem; render(); window.scrollTo(0, 0); break;
      case "recognize": if (!screen.listening) startRecognition(); break;
      case "record": toggleRecord(); break;
      case "play-rec": if (screen.recUrl) new Audio(screen.recUrl).play(); break;
      case "speak-next": screen.i++; screen.result = ""; if (screen.recUrl) { URL.revokeObjectURL(screen.recUrl); screen.recUrl = null; } render(); break;
      case "write-demo": if (writer) { writer.cancelQuiz(); writer.animateCharacter({ onComplete: startQuiz }); } break;
      case "write-again": if (writer) { writer.cancelQuiz(); startQuiz(); } break;
      case "write-next": screen.i++; render(); break;
      case "write-prev": screen.i = Math.max(0, screen.i - 1); render(); break;
      case "scan-go": screen.text = document.getElementById("scan-input").value; render(); break;
      case "scan-sample": screen.text = SAMPLE_LABEL; render(); break;
      case "scan-add": {
        var run = "", started = false;
        for (var k = 0; k < screen.segs.length; k++) {
          var sg = screen.segs[k];
          if (sg.unknown) { run += sg.t; started = true; } else if (started) break;
        }
        go({ name: "mine", form: { h: run, p: guessPinyin(run), r: "" } });
        break;
      }
      case "mine-save": {
        var f = readForm();
        if (!f.h || !f.r) { screen.form = f; screen.formMsg = "Нужны иероглифы и перевод."; render(); break; }
        if (!f.p) f.p = guessPinyin(f.h);
        var dup = vocabItems().some(function (it) { return it.h === f.h; });
        if (dup) { screen.form = f; screen.formMsg = "Это слово уже есть в уроках или словаре."; render(); break; }
        state.mine.unshift(f); introduce(f); save();
        screen.form = null; screen.formMsg = "Сохранено: " + esc(f.h); render();
        break;
      }
      case "audio-toggle": if (screen.playing) { audioStop(); render(); } else audioStart(); break;
      case "audio-next": audioStop(); screen.i++; render(); break;
      case "audio-prev": audioStop(); screen.i = Math.max(0, screen.i - 1); render(); break;
      case "play-dialogue": sayDialogue(lessonById(screen.id).dialogue); break;
      case "show-review": screen.shown = true; render(); say(screen.queue[0].h); break;
      case "reset": screen.confirm = true; render(); break;
      case "reset-no": screen.confirm = false; render(); break;
      case "reset-yes": state.cards = {}; state.lessons = {}; save(); screen.confirm = false; render(); break;
    }
  });
  app.addEventListener("change", function (e) {
    if (e.target.id === "fic-date" && e.target.value) { state.settings.fic = e.target.value; save(); }
    if (e.target.id === "src-select") { audioStop(); screen.src = e.target.value; screen.i = 0; screen.result = ""; render(); }
  });
  app.addEventListener("input", function (e) {
    if (e.target.id === "num-input") { screen.num = e.target.value; document.getElementById("num-out").innerHTML = numberCard(screen.num, screen.unit || ""); }
    if (e.target.id === "mine-h") {
      var p = document.getElementById("mine-p"), g = guessPinyin(e.target.value);
      if (p && g && (!p.value || p.dataset.auto)) { p.value = g; p.dataset.auto = "1"; }
    }
    if (e.target.id === "mine-p") delete e.target.dataset.auto;
  });
  // Listening questions play on their own when they appear.
  function autoPlay() {
    if (screen.name !== "quiz" || !screen.qs || screen.i >= screen.qs.length) return;
    var q = screen.qs[screen.i];
    if (q.kind === "tone" || q.kind === "listen-py" || q.kind === "listen-hz") setTimeout(function () { say(q.item.h); }, 250);
  }
  var _go = go;
  go = function (s) { _go(s); autoPlay(); };

  render();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    // When an update installs, reload once so the new lessons show up right away.
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (hadController) location.reload(); });
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
