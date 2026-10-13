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
    return all;
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
  function go(s) { screen = s; render(); window.scrollTo(0, 0); }

  function render() {
    if (hasSpeech) speechSynthesis.cancel();
    var fn = { home: home, lesson: lesson, learn: learn, quiz: quiz, review: review, settings: settings }[screen.name];
    app.innerHTML = fn();
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
      planCard() + list +
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

  // ---------- events ----------
  app.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var d = b.dataset;
    if (d.go) { var s = { name: d.go }; if (d.id) s.id = d.id; go(s); return; }
    if (d.say != null) { say(lessonById(screen.id).items[+d.say].h); return; }
    if (d.speak) { say(d.speak); return; }
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
      case "play-dialogue": sayDialogue(lessonById(screen.id).dialogue); break;
      case "show-review": screen.shown = true; render(); say(screen.queue[0].h); break;
      case "reset": screen.confirm = true; render(); break;
      case "reset-no": screen.confirm = false; render(); break;
      case "reset-yes": state.cards = {}; state.lessons = {}; save(); screen.confirm = false; render(); break;
    }
  });
  app.addEventListener("change", function (e) {
    if (e.target.id === "fic-date" && e.target.value) { state.settings.fic = e.target.value; save(); }
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
