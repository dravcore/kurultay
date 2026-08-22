# Tasarım

Kurul web uygulamasının görsel ve etkileşim dili: ilkeler, token'lar, yerleşim, hareket,
durumlar ve metin.

> 🌐 [English (canonical)](../design.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [1. Tasarım ilkeleri](#1-tasarım-ilkeleri)
- [2. Kimlik](#2-kimlik)
- [3. Tasarım token'ları](#3-tasarım-tokenları)
- [4. Yerleşim ve yoğunluk](#4-yerleşim-ve-yoğunluk)
- [5. Etkileşim kalıpları](#5-etkileşim-kalıpları)
- [6. Durumlar](#6-durumlar)
- [7. UI metni](#7-ui-metni)
- [8. Grafikler ve dashboard](#8-grafikler-ve-dashboard)
- [9. Erişilebilirlik](#9-erişilebilirlik)
- [10. Çapraz referanslar](#10-çapraz-referanslar)

> **Durum.** Aşağıdaki renk, tipografi ve spacing token'ları üründe **doğrulanmıştır**
> (`apps/web/app/globals.css`). Hâlâ aspirasyonel olan etkileşim kalıpları satır içinde
> belirtilir; her cümleyi shipped davranış sanmayın.

## 1. Tasarım ilkeleri

1. **Nefes alanıyla yoğunluk.** Bir board bir çalışma yüzeyidir. Satırlar kompakttır ve hava
   grupların _arasına_ gider, asla içine değil — 36px satırlar, 300px column'lar, bir laptop'ta
   dört kart. Trello kadar havadar değil, Jira kadar sıkışık değil.
2. **Klavye öncelikli, pointer'la eşit.** Her etkileşimin bir klavye yolu vardır, drag and drop
   dahil. Focus her zaman görünürdür ve ait olmadığı bir yerde asla hapsolmaz.
3. **Tek bir signature, sakin bir çevre.** Kimliği (§2) tam olarak tek bir eleman taşır; geri
   kalan her şey disiplinli nötrlerdir. Birinin işi bulmasına, taşımasına veya iş hakkında karar
   vermesine yardımcı olmayan her şey kesilir.
4. **Her iki tema da birinci sınıftır.** Koyu tema _seçilir_, türetilmez. Her renk bir
   token'dan geçer; bir component'teki ham bir hex bir kusurdur
   ([coding-standards.md](coding-standards.md#stil)).
5. **Durumlar bir ruh hali değil, bir yöndür.** Boş ekranlar bir aksiyona davet eder, hatalar ne
   olduğunu ve sırada ne yapılması gerektiğini söyler, yükleme ekranı yüklenmekte olan şeye
   benzer.
6. **String'ler bir tasarım malzemesidir.** Metin, spacing gibi tasarlanır, ekranın kullanıcı
   tarafından yazılır ve ilk günden itibaren i18n katmanı üzerinden sunulur (§7).

## 2. Kimlik

Kurul, adını toplanıp karar alan ve işi bölüşen heyetten alır — ve v0.2.0'a kadar projeye ilk
adını veren _kurultay_'dan: boylar toplanır, sancaklar dikilir, meseleler karara bağlanır, iş
bölüştürülür. Kimlik hâlâ _bu_ dünyadan gelir — sancak, damga, bozkır — jenerik
prodüktivite-aracı dilinden değil. Ad kısaldı, görsel dil değişmedi.

**Signature eleman — sancak rail'i:** o an aktif olan neyse onun leading edge'inde 2px'lik bakır
renginde bir çizgi (aktif sidebar öğesi, focus'taki column, seçili kart, açık panelin leading
edge'i, bir drag sırasındaki insertion point). App chrome'da signature rengin tam yoğunlukta
göründüğü tek yerdir ve _hareket eder_ — yanıp sönmek yerine pozisyonlar arasında kayarak geçer.
Renkli bir header veya tonlanmış bir background yerine bu seçildi çünkü layout'a hiçbir maliyeti
yok, 36px satır yüksekliğinde hayatta kalıyor, yoğun bir column'da anında okunuyor — ve kelimenin
tam anlamıyla meclisin toplandığı yere dikilen sancaktır.

| Signature bakır nerede görünebilir                         | Nerede görünmemeli                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| Sancak rail'i (aktif / seçili / drop target)               | Sayfa veya section background'ları, header'lar, hero wash'ları |
| Primary action button'ları — view başına en fazla bir tane | Secondary ve tertiary button'lar                               |
| Focus ring, selection ring, meter ve progress fill'leri    | Kart border'ları, divider'lar, tablo header'ları               |
| Body metni içindeki link'ler                               | Label'lar, priority badge'leri, status badge'leri, avatar'lar  |
| Wordmark ve empty-state mark'ları                          | Grafikler, tek **emphasis** ton'u dışında (§8)                 |

Aynı anda iki bakır şey görünüyorsa ve hiçbiri bir primary action değilse, biri yanlıştır.

| İkonografi                                              | Kural                                                                                                                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark, empty state'ler, auth ve marketing görselleri | **Damga esinli mark'lar** — 24px grid üzerinde geometrik, tek stroke'lu tamga formları, 1.5px stroke, surface başına bir tane, maksimum 96px. El yapımı SVG; asla bir ürün ikonu değil. |
| Tüm ürün arayüzü                                        | **lucide** (shadcn/ui ile birlikte gelir) — dense satırlarda 16px, sidebar'da 20px, 1.5px stroke, yalnızca `currentColor`                                                               |

**Anti-brief.** Bilinçli olarak _şu değil_: serif bir font ve kiremit rengi bir accent'le sıcak
krem bir ground; asit bir accent'le neredeyse siyah; sıfır radius'ta broadsheet hairline'ları.
Kurul'un nötrleri bilinçli olarak soğuk yeşil-gri akar — tam olarak sıcak bakırın karşısına
oturacağı bir şey olsun diye; sıcak bir ground üzerinde sıcak bir accent hem şu anki varsayılan
görünüm hem de accent'i kaybettirmenin bir yolu.

## 3. Tasarım token'ları

Faz 3 için öneriler, `components/ui/`'ın değiştirilmemiş generated output olarak kalması için
shadcn/ui CSS-variable konvansiyonuna göre adlandırıldı. **Dikkat:** shadcn'in kendi
vokabülerinde `--primary` marka action rengidir ve `--accent` ise subtle hover surface'idir; bu
yüzden Kurul'un signature bakırı `--primary`'dir ve `--accent` sakin bir nötr tint olarak
kalır. shadcn'in variable'larını yeniden adlandırma.

### Nötrler ve accent

Düşük kroma bir yeşil-gri ("felt") ramp'i. Açık temanın canvas'ı bir gri adımıdır ve kartlar
beyazdır, bu yüzden elevation shadow olmadan okunur.

| Rol                                        | Token                          | Açık                  | Koyu                  |
| ------------------------------------------ | ------------------------------ | --------------------- | --------------------- |
| Canvas                                     | `--background`                 | `#F7F8F7`             | `#0E100F`             |
| Kart / panel surface'i                     | `--card`, `--popover`          | `#FFFFFF`             | `#161918`             |
| Yükseltilmiş surface (hover, drag preview) | `--muted`                      | `#F1F3F1`             | `#1D2120`             |
| Border · border-strong                     | `--border` · `--border-strong` | `#D6DAD8` · `#B9BFBC` | `#2A2F2D` · `#383E3B` |
| Metin, primary                             | `--foreground`                 | `#191C1B`             | `#E8ECEA`             |
| Metin, secondary                           | `--foreground-secondary`       | `#545A57`             | `#B3BAB6`             |
| Metin, muted                               | `--muted-foreground`           | `#6B726E`             | `#8A928E`             |
| Metin, disabled / placeholder              | `--foreground-disabled`        | `#8A918D`             | `#6E7773`             |
| Primary action surface'i                   | `--primary`                    | `#A85A28`             | `#D98A4E`             |
| Primary üzerinde metin                     | `--primary-foreground`         | `#FFFFFF`             | `#0E100F`             |
| Rail, focus ring, link                     | `--signature`, `--ring`        | `#A85A28`             | `#D98A4E`             |
| Signature tint (seçili satır, drop zone)   | `--signature-subtle`           | `#F6EDE5`             | `#241A12`             |

Kart surface'i üzerinde ölçüldü — metin: açık 17.2 / 7.1 / 4.9:1, koyu 14.9 / 9.0 / 5.6:1. Bakır:
açık temada beyaz metni 5.05:1'de taşıyor ve canvas üzerinde metin olarak 4.74:1'de okunuyor;
koyu temada ink'i 7.00:1'de taşıyor ve koyu surface üzerinde 6.49:1'de okunuyor. Hepsi AA'yı net
şekilde geçiyor.

### Semantik skalalar — status ve priority

Rezerve edilmiş tek bir severity ailesi ikisine de hizmet eder, her zaman bir **ikon ve bir
kelimeyle** birlikte shiplenir, asla yalnızca renkle değil. priority, label'lardan ayrı tutulan
sıralı bir skalerdir; sırası artan kroma ile taşınır, böylece renk körlüğünden, grayscale
baskıdan ve sesli tarif edilmekten sağ çıkar.

| Anlam                            | priority | Token                                 | Açık      | Koyu      | Kontrast A / K | İkon           |
| -------------------------------- | -------- | ------------------------------------- | --------- | --------- | -------------- | -------------- |
| Nötr / inaktif                   | `LOW`    | `--priority-low`                      | `#6B726E` | `#8A928E` | 4.9 / 5.6      | `chevron-down` |
| Bilgi                            | `MEDIUM` | `--status-info`, `--priority-medium`  | `#3F6B99` | `#6BA3E8` | 5.6 / 6.8      | `minus`        |
| İyi / tamamlandı                 | —        | `--status-good`                       | `#1F7A4D` | `#3FBF85` | 5.3 / 7.6      | `check`        |
| Uyarı / süresi yaklaşıyor        | `HIGH`   | `--status-warning`, `--priority-high` | `#8A5A00` | `#D9A227` | 5.9 / 7.7      | `chevron-up`   |
| Tehlike / gecikmiş / destructive | `URGENT` | `--status-danger`, `--destructive`    | `#C0281F` | `#F0665C` | 5.9 / 5.7      | `chevrons-up`  |

priority, full-kroma bir ikon artı metin olarak render edilir; label'lar ise renkli bir nokta ile
tonlanmış bir chip olarak render edilir — farklı ağırlıklar, böylece kırmızı bir priority ile
kırmızı bir label asla aynı okunmaz. `Label.color` bir hex değil, bir **slot adı** (`slot-1`…
`slot-8`) saklar, böylece bir label'ın chip'i ile bir grafikteki bar'ı, temaya göre resolve
edilen tek bir identity olur (§8).

### Tipografi — öneri

Open-source, self-hostable, komple Latin Extended-A: Turkish (`ı İ ğ ş ç ö ü`) doğru render
edilmelidir çünkü ilk çeviri paketi budur — bu gereksinim, moda display font'larının çoğunu
elemiştir. Üçü de build time'da `next/font/google` ile self-hosted'dır (Next font dosyalarını
indirir ve gömer — binary font asset'lerini repoya commit etmeden `next/font/local` ile
eşdeğer).

| Rol       | Font                                                         | Nerede                                                                      | Neden bu                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display   | **Fraunces** (variable, OFL), `WONK 0 SOFT 0`, yüksek `opsz` | Wordmark, auth, marketing, empty-state headline'ları. Board'un içinde asla. | Kaligrafik değil, high-contrast ve oyulmuş gibi — bir mühüre kazınmış bir şey gibi okunuyor, ki bu tam olarak _damga_ register'ı. Axis'leri quirk'i sıfıra çekip yalnızca gravürü tutmamızı sağlıyor.                                             |
| Body / UI | **Archivo** (variable, OFL)                                  | Üründeki her şey                                                            | Bir signage grotesque: yüksek x-height, ekonomik genişlikler, 12–13px'te okunaklı. Bir board, dar column'larda yüzlerce kısa string demek — bir signage problemi. Doğru olan ama framework varsayılanı gibi okunan Inter ve Geist yerine seçildi. |
| Mono      | **JetBrains Mono** (OFL), `0.92em`                           | Id'ler, shortcut'lar, kod                                                   | Belirsiz olmayan `0/O` ve `1/l/I` — bir stil tercihi değil, bir UUIDv7 okunabilirlik aracı                                                                                                                                                        |

| Adım                   | Boyut / satır     | Weight    | Kullanım                                                             |
| ---------------------- | ----------------- | --------- | -------------------------------------------------------------------- |
| `display`              | 40 / 44           | 600       | Auth veya marketing ekranı başına bir tane                           |
| `title-lg` · `title`   | 20 / 28 · 16 / 24 | 600       | Sayfa ve panel başlıkları · section ve dialog başlıkları             |
| `body` · `body-strong` | 13 / 18           | 400 · 550 | **UI baseline** — field'lar ve satırlar · kart başlıkları, aktif nav |
| `small` · `micro`      | 12 / 16 · 11 / 14 | 400 · 500 | Metadata, timestamp'ler · chip'ler, count'lar, axis tick'leri        |

`tabular-nums`, sayı column'larında, axis tick'lerinde ve tablo hücrelerinde — asla bir hero
figure veya bir stat-tile değeri üzerinde değil.

### Spacing, radius, elevation

| Sistem    | Değerler                                                                                                                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing   | `2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 48` — 2px'lik bir half-step'e sahip 4px'lik bir base; dense bir satırı hayatta tutan şey bu half-step                                                                                                                                                       |
| Radius    | `sm 4` chip'ler · `md 6` button'lar, input'lar, kart'lar · `lg 10` panel'ler, dialog'lar · `full` avatar'lar. shadcn varsayılanından daha sıkı; büyük radius'lar yumuşak okunur ve kullanılabilir genişlikten çalar.                                                                                  |
| Border    | 1px hairline `--border`; 2px yalnızca sancak rail'i ve focus ring'ler için                                                                                                                                                                                                                            |
| Elevation | **Önce border'lar, en son shadow'lar.** Açık temada depth = gri canvas üzerinde beyaz kart + hairline; koyu temada depth = daha açık bir surface adımı, çünkü shadow'lar koyu temada okunmuyor ve bir glow daha kötü. Gerçek shadow'lar yalnızca üç yerde var: dialog'lar, popover'lar, drag preview. |

## 4. Yerleşim ve yoğunluk

App shell, [architecture.md §4](architecture.md#4-appsweb--yapı)'teki `(app)` route group'una
göre.

| Bölge                | Spec                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell yüksekliği     | Tam olarak `100dvh`, `overflow: hidden` — asla `min-height` değil. Her sayfa kendi scroller'ına sahiptir.                                     |
| Sidebar              | 240px, üstte pinlenmiş workspace switcher; 1280px altında ve talep üzerine 56px'lik bir icon rail'ine collapse olur; 768px altında off-canvas |
| Topbar               | 48px sticky — board adı, filter girişi, overflow, presence avatar'ları; **768px altında 56px**, ve orada gezinme trigger'ını da taşır         |
| Board canvas         | Full-bleed, horizontal scroll; column header'ları vertical scroll'da sticky kalır                                                             |
| Column               | 300px fixed (geniş ekranlarda 280 min / 320 max), 12px gap, isim + count + `⋯` içeren 40px sticky header (768px altında 48px)                 |
| Card                 | 10px 12px padding, 8px gap, min 56px (yalnızca title), tipik 72–92px; hiçbir şeyin ~140px'i aşmaması için title 3 satırda clamp'lenir         |
| Card içerik sırası   | priority ikonu + title · label dot'ları · meta satırı (due date, estimate, assignee'ler)                                                      |
| List / table satırı  | 36px; 768px altında 44px                                                                                                                      |
| Settings ve form'lar | 720px max width — prose okunur, taranmaz                                                                                                      |
| Touch target         | **768px altında 44px minimum**, istisnasız her etkileşimli öğede                                                                              |

**Shell tam olarak bir viewport yüksekliğindedir ve bu taşıyıcı bir karardır.**
`min-height: 100dvh` "en az" der ve altındaki hiçbir şeyi sınırlamaz — yaptığı da buydu, ve
bir column'un `overflow-y-auto`'sunun neden hiç kırpmadığının sebebi budur: belge büyüyordu,
1 000 task'lık bir board'da 27 425px'e ulaşıyordu. Column başına scroll, sticky column header'ı
ve drag autoscroll'un üçü de column'un sınırlı bir kutuya sahip olmasına bağlı; dolayısıyla
üçü de işlevsizdi. `100vh` değil `100dvh`: telefonda `100vh`, browser chrome'u geri çekilmiş
haldeki viewport'tur, yani `vh` ile boyutlanmış bir shell ekrandan yüksektir ve ilk paint'te
topbar'ı adres çubuğunun altına iter. Yeni sayfa eklerken uyulacak sonuç: **uygulamanın hiçbir
yerinde belge scroll etmez**, bu yüzden `(app)` altındaki yeni bir route kendi
`flex-1 overflow-y-auto`'sunu bildirmek zorundadır — dashboard, settings ve notifications
sayfalarının yaptığı gibi.

**768px altında sidebar off-canvas'tır** — topbar'daki bir hamburger, aynı `SidebarBody`'yi
bir drawer'da açar; kendi link listesi olan ikinci bir gezinme değil. Drawer, uygulamanın
`Dialog` primitive'inin sol kenara sabitlenmiş hali (`DialogDrawerContent`), ve bu bilinçli
bir "elle yazmayı reddetme"dir: focus trap, `Escape`, focus'u trigger'a geri verme, arkadaki
sayfayı inert kılma ve scroll lock, bir off-canvas panelin bütün özüdür — paralel bir
implementasyon, bunlardan birinin eksik kalabileceği ikinci bir yerdir. 220ms'de
`--ease-drawer` ile kayar, `prefers-reduced-motion` altında ise kaymak yerine cross-fade eder.

**40 değil 44, ve pointer tipine değil genişliğe bağlı.** 44px, WCAG 2.5.5 (AAA) ve roadmap'in
bu yerleşimi tuttuğu rakam. `pointer: coarse` yerine drawer'ın kullandığı breakpoint'e —
`max-md` — bağlıdır: birbiriyle çelişebilecek iki koşul yerine tüm mobil yerleşimi tek bir
koşul yönetsin diye. Masaüstünde 360px genişliğinde bir pencerenin 44px hedef alması bir şeye
mal olmaz. Zemin, çağrı yerlerinde değil `Button` ile `Input` variant'larında ve dropdown item
sınıflarında yaşar; böylece okunacak tek bir liste vardır. Breakpoint üstündeki ölçüler
değişmez. Ve bu **iddia edilmez, ölçülür**: `e2e/tests/mobile-navigation.spec.ts`, 360px'te
board'daki ve drawer'daki her button, link, input ve menu item'ını tarar ve iki eksenden
birinde 44px'in altındaki her kutuda fail eder. jsdom hiçbir şeyi layout etmediği için bir
unit test bu iddiayı kuramaz.

**Touch'ta drag grip'ten yapılır.** Kart gövdesi column'un scroller'ına aittir — dnd-kit
listener'larını taşıyan wrapper'ın kendi `touch-action`'ı yoktur, dolayısıyla dikey bir
hareketi browser üstlenir — grip ise `touch-action: none` bildirir, ve o 44px'lik tek bölgeyi
dnd-kit'e veren şey budur. Bu bir kısıt değil, bir iş bölümüdür: başparmakla scroll edilemeyen
bir column, ortasından sürüklenemeyen bir karttan daha kötüdür. İki yarı da test edilir.

**Task detayı: bir modal değil, sağ tarafta bir panel.** Varsayılan 480px, drag-resizable
420–640px, **non-modal** — board arkasında görünür ve tıklanabilir kalır. 1024px altında
full-screen bir sheet'e dönüşür. Confirmation'lar, board oluşturma ve destructive aksiyonlar
**dialog** olarak kalır; onların gerçekten block etmesi gerekir.

| Neden bir panel |                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context         | Bir board'un amacı çevresindeki kartlardır; bir modal onları siler                                                                                       |
| Flow            | Triage open → edit → next'tir. Bir panel, bir dismiss artı bir click yerine, bir sonraki kartı tek bir click uzakta tutar.                               |
| Realtime        | Bir modal'ın altında hareket eden bir kart görünmezdir; bir panelin arkasında görünürdür                                                                 |
| Routing         | Bir intercepting route üzerinden `board/[boardId]/task/[taskId]`'te deep-linkable — paylaşılan bir URL full page'i açar, board içi bir click paneli açar |

## 5. Etkileşim kalıpları

| Drag and drop | Kural                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lift          | Kart `1.02`'ye scale olur, `1deg` tilt olur, tek drag shadow'u alır; source, aynı yükseklikte bir `--muted` ghost bırakır, böylece board drag ortasında asla reflow olmaz                                                                                                                                                             |
| Drop target   | Insertion gap kart yüksekliğine açılır ve leading edge'inde **sancak rail'ini** gösterir; destination column bir `--signature-subtle` wash alır. Dashed outline yok.                                                                                                                                                                  |
| Commit        | Optimistic — kart anında yerine oturur, ardından `PATCH .../tasks/:taskId/position` gelir                                                                                                                                                                                                                                             |
| Failure       | Kart orijinal pozisyonuna geri animate olur (220ms, `--ease-in-out`) ve bir toast, bir **Try again** (**Tekrar dene**) kontrolüyle ne olduğunu söyler. Optimistic state hiçbir zaman öylece bırakılmaz.                                                                                                                               |
| Keyboard      | `@dnd-kit` `KeyboardSensor` — `Space` lift yapar, arrow'lar column içinde ve column'lar arasında taşır, `Space` drop yapar, `Esc` cancel eder. Her transition `aria-live="polite"` üzerinden duyurulur: "Moved _Fix login redirect_ to In Progress, position 2 of 5." ("_Fix login redirect_ In Progress'e taşındı, pozisyon 2 / 5.") |
| Autoscroll    | Her iki axis, 24px edge zone                                                                                                                                                                                                                                                                                                          |

| Realtime değişikliği   | Surfacing (asla bir layout jump)                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote create / update | 1200ms boyunca fade out olan bir `--signature-subtle` background. Hareket yok, size değişimi yok. Yalnızca renk, böylece `prefers-reduced-motion`'dan değişmeden çıkar. |
| Remote move            | Kart 220ms boyunca yeni pozisyonuna animate olur; local bir drag sırasında update queue'lanır ve drop'ta uygulanır                                                      |
| Remote delete          | 160ms boyunca 0'a fade olur, ardından gap 160ms boyunca kapanır — iki beat, gözün takip edebilmesi için                                                                 |
| Presence · disconnect  | Topbar'da avatar'lar, başkasının açık tuttuğu bir kartta küçük bir avatar · sessiz, inline bir "Reconnecting…" ("Yeniden bağlanıyor…") bar'ı, asla blocking bir overlay |

**Keyboard baseline.** Focus her zaman görünürdür: 2px offset'te 2px `--ring`, ve bir
replacement olmadan `outline: none` bir review blocker'dır. Tab order visual order'ı takip eder;
board bir composite widget'tır, bu yüzden `Tab` bir column'a ulaşır ve arrow'lar onun içinde
hareket eder. `Esc` yalnızca en üstteki layer'ı kapatır ve focus'u onu açan şeye geri verir.
Şimdiden reserve edilmiş, Faz 4+'ta map edilecek: `⌘K` command palette, `C` create task, `/`
filter, `?` help — başka hiçbir şey çıplak bir letter key talep etmez.

**Motion.** Yalnızca amaçlı micro-interaction'lar, **view başına en fazla bir orchestrated an** —
board'da bu, column'ların ilk paint'idir, başka hiçbir şey değil.

| Durum                                                      | Süre                  | Curve                                                     |
| ---------------------------------------------------------- | --------------------- | --------------------------------------------------------- |
| Press feedback (`scale(0.97)`) · sancak rail'inin hareketi | 100–160ms             | `--ease-out`                                              |
| Tooltip, küçük popover                                     | 125–200ms             | `--ease-out`                                              |
| Dropdown, select, menu                                     | 150–250ms             | `--ease-out`, `transform-origin: var(--transform-origin)` |
| Detay paneli, sheet                                        | 220ms                 | `--ease-drawer`                                           |
| Dialog · toast (`translateY(100%)`)                        | 200ms                 | `--ease-out`, dialog origin ortalanmış                    |
| Başarısız bir drop'tan sonra kartın geri dönmesi           | 220ms                 | `--ease-in-out`                                           |
| İlk board paint'inde column stagger'ı                      | column'lar arası 40ms | `--ease-out`                                              |

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1); /* entering, exiting, default */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1); /* moving on screen */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1); /* panel and sheet */
```

- **Keyboard-initiated aksiyonlarda animasyon yok** — command palette anında açılır; günde yüz
  kere çalışır ve motion onu yavaş hissettirir.
- **Yalnızca `transform` ve `opacity`** (accordion height hariç). Asla `transition: all`, asla
  `scale(0)` — `scale(0.96)` + `opacity: 0`'dan enter et. UI'de asla `ease-in`: kullanıcının tam
  o an izlediği ana gecikme getirir.
- Saniyede iki kez tetiklenebilecek her şey için (toast'lar, toggle'lar, rail) **keyframe değil
  transition** — transition'lar mevcut değerden retarget eder, keyframe'ler sıfırdan yeniden
  başlar.
- Panel hariç 300ms'i geçen hiçbir şey yok. Hover motion'ı `@media (hover: hover) and
(pointer: fine)`'ın arkasına gate'le. Spring'ler (`{ duration: 0.5, bounce: 0.2 }`) yalnızca
  bir gesture'ın velocity taşıdığı yerlerde — drag preview, swipe-to-dismiss.
- **`prefers-reduced-motion: reduce`** hareketi düşürür ve opacity ile rengi korur: panel
  cross-fade olur, rail zıplar, highlight değişmeden kalır. Daha az ve daha nazik, sıfır değil.

## 6. Durumlar

**Empty state'ler birer davettir** — screen başına bir damga mark'ı ve bir primary action. Bir
sonraki hamleyi adlandırırlar; feature'ı açıklamazlar. Damga mark'larının göründüğü tek yer
burasıdır.

| Surface                           | Mark       | Headline                                                       | Body                                                                                                                                                                                                                                                              | Action                                                                         |
| --------------------------------- | ---------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Henüz board yok                   | Damga 96px | No boards yet (Henüz board yok)                                | A board is where the work gets divided. Start with one. (Bir board, işin bölüştüğü yerdir. Bir tane ile başlayın.)                                                                                                                                                | Create board (Board oluştur)                                                   |
| Board'da column yok               | Damga 96px | This board has no columns (Bu board'da column yok)             | Columns are the stages work moves through. Start with To Do, In Progress, and Done, or name your own. (Column'lar, işin içinden geçtiği aşamalardır. To Do (Yapılacak), In Progress (Devam Ediyor) ve Done (Bitti) ile başlayın, ya da kendi isimlerinizi verin.) | Add column · Use default columns (Column ekle · Varsayılan column'ları kullan) |
| Boş column                        | —          | —                                                              | 56px dashed drop zone: "Drop a task here" ("Bir task'ı buraya bırakın")                                                                                                                                                                                           | Add task (Task ekle)                                                           |
| Filtreler hiçbir şeyle eşleşmiyor | —          | No tasks match these filters (Bu filtrelerle eşleşen task yok) | Three filters are active. (Üç filtre aktif.)                                                                                                                                                                                                                      | Clear filters (Filtreleri temizle)                                             |
| Dashboard, veri yok               | Damga 64px | Nothing to chart yet (Henüz grafiklenecek bir şey yok)         | Charts fill in as tasks are created and moved. (Task'lar oluşturuldukça ve taşındıkça grafikler dolar.)                                                                                                                                                           | Open a board (Bir board aç)                                                    |
| Bildirimler                       | —          | You're caught up (Her şeyi gördünüz)                           | —                                                                                                                                                                                                                                                                 | —                                                                              |

**Loading**, `--muted` içinde final layout'a uyan skeleton'lar kullanır, 1.6s'lik bir opacity
pulse'ı ile (1.0 → 0.6) ve shimmer sweep olmadan: board, gerçek genişlikte column skeleton'ları
render eder, gerçek kart yükseklikte üç kart skeleton'ıyla birlikte; task paneli, tıklanan kartın
title'ı zaten yerindeyken anında açılır, böylece asla boş görünmez; inline aksiyonlar
optimistic'tir. Spinner'lar tam olarak tek bir yerde var — basılı bir button'ın içinde, 14px,
400ms sonra ikonun yerine geçerek. List içeriği asla bir tane almaz. Bilinmeyen uzunluktaki iş
(import, export) count'lu bir progress bar alır.

**Error'lar**, [api-conventions.md](api-conventions.md#hatalar)'daki problem-JSON şeklinden
türer. O contract'a göre UI **`statusCode` ve `error` üzerinden branch'lenir, asla `message`
metni üzerinden değil** — bu yüzden kullanıcıya görünen string'ler i18n katalogundan gelir ve API
`message`'ı gösterilmez, loglanır. Yalnızca `details[]` surface edilir, çünkü field-level ve
güvenlidir. Başarısız olan object'i adlandırın, bir sonraki aksiyonu gerçek bir control olarak
verin, tek bir cümlede tutun ve asla bir id, bir stack trace, ya da "Oops" kelimesini
yazdırmayın.

| Status                         | Surface                                           | Metin                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400` / `422`, `details[]` ile | Her field'ın altında inline; focus ilkine gider   | `details[].constraint`'ten, bir katalog string'ine map'lenir: "Title can't be empty" ("Title boş olamaz")                                                                                |
| `401`                          | Return URL'i koruyarak sign-in'e redirect         | Your session ended. Sign in to pick up where you left off. (Oturumunuz sona erdi. Kaldığınız yerden devam etmek için giriş yapın.)                                                       |
| `403`                          | Block edilen control üzerinde inline              | You need admin access to change columns. Ask a workspace owner. (Column'ları değiştirmek için admin erişimine ihtiyacınız var. Bir workspace owner'ından isteyin.)                       |
| Panelde `404`                  | Panel body'sinin yerini alır                      | This task no longer exists. Someone may have deleted it. (Bu task artık mevcut değil. Biri onu silmiş olabilir.) → **Back to board** (**Board'a dön**)                                   |
| `409`                          | Stale editor üzerinde dialog                      | Someone changed this task while you were editing. (Siz düzenlerken birisi bu task'ı değiştirdi.) → **Reload** (**Yeniden yükle**) · **Copy my changes** (**Değişikliklerimi kopyala**)   |
| `429` · `5xx`                  | Toast · içeriğin olması gereken yerde error block | Too many requests. Try again in a few seconds. (Çok fazla istek. Birkaç saniye içinde tekrar deneyin.) · The board couldn't load. (Board yüklenemedi.) → **Try again** (**Tekrar dene**) |
| Offline                        | Kalıcı topbar strip'i                             | You're offline. Changes won't save until the connection is back. (Çevrimdışısınız. Bağlantı geri gelene kadar değişiklikler kaydedilmeyecek.)                                            |

## 7. UI metni

Ekranın kullanıcı tarafından, active voice, sentence case.

| Bunun yerine                                             | Şunu yaz                                      | Neden                                 |
| -------------------------------------------------------- | --------------------------------------------- | ------------------------------------- |
| Submit (Gönder)                                          | Save changes (Değişiklikleri kaydet)          | Ne olacağını söyler                   |
| Oops! Something went wrong (Hata! Bir şeyler ters gitti) | The board couldn't load. (Board yüklenemedi.) | Object'i adlandırır                   |
| Task successfully created! (Task başarıyla oluşturuldu!) | Task created (Task oluşturuldu)               | Button'ın verb'i, ünlem yok           |
| Are you sure? (Emin misiniz?)                            | Delete this board? (Bu board'u sil?)          | Soru, sonucun kendisidir              |
| Invalid input (Geçersiz giriş)                           | Title can't be empty (Title boş olamaz)       | Spesifik olmak akıllı olmaktan iyidir |
| Users / Org / Entity                                     | Members / Workspace / Task                    | Schema değil, product vocabulary'si   |
| Socket disconnected (Socket bağlantısı kesildi)          | Reconnecting… (Yeniden bağlanıyor…)           | Kullanıcı tarafı adlandırma           |
| Position updated (Pozisyon güncellendi)                  | Moved to In Progress (In Progress'e taşındı)  | Row'un değil, kullanıcının ne yaptığı |

- **Bir flow boyunca tek bir verb:** button **Create board** (**Board oluştur**) → dialog
  **Create board** (**Board oluştur**) → toast **Board created** (**Board oluşturuldu**).
  Button'lar aksiyonlarını adlandırır, asla Yes/No/OK değil; destructive olanlar object'i
  adlandırır. Verb, failure'a kadar korunur: bir **Add column** (**Column ekle**) button'ı
  "Could not _create_ this column." ("Bu column _oluşturulamadı_.") diye başarısız olmaz.
- **Üçüncü vuruş yalnızca ekranın sonucu gösteremediği yerde vardır.** Bir card cursor'ın altına
  iner, yeniden adlandırılmış bir column yeni adını gösterir, silinen bir board grid'den çıkar —
  bunlar kendilerini doğrular, üstüne bir toast gürültüdür. Etki ekran dışındaysa (bir inbox,
  saklanan bir tercih), değişen şeyin ekranda bir karşılığı yoksa (bir column'ın `category`'si),
  ya da değişiklik view'ın kabul ettiğinden daha uzağa uzanıyorsa (bir board label'ını silmek onu
  her task'tan çıkarır) doğrula. Sessizlik default'tur; mesaj, kendini hak etmesi gereken
  istisnadır.
- **Element başına bir görev.** Bir label label'lar, helper text açıklar, bir placeholder bir
  örnek gösterir — bir placeholder asla bir label değildir.
- **Internal'ları asla ifşa etme** (`workspaceId`, `position`, "fractional index", "optimistic
  update"). Id'ler yalnızca bir copy-id affordance'ının arkasında, mono'da görünür.
- **Date'ler ve süreler:** şimdiye yakın relative ("in 2 days" / "2 gün içinde"), bir haftadan
  öte absolute, exact değer her zaman `title`'da. `estimatedMinutes`, asla "150" değil "2h 30m"
  ("2s 30dk") render eder.

**Her error bir çıkış yoluyla biter.** Başarısız olan object'i adlandırmak mesajın yalnızca
yarısıdır; diğer yarısı bir sonraki hamledir. Bunu hangi yarının taşıdığına tek bir soru karar
verir — **aynı request ikinci bir denemede başarılı olabilir mi?**

|                       | **Hayır** — server kendini açıkladı                                                                                                                | **Evet** — server açıklamadı                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Recovery nerede yaşar | **Cümlede**                                                                                                                                        | **Surface'te**                                                                         |
| Kullanıcı ne alır     | Sebep, ardından onu değiştiren tek hamle: bir admin'e sor, reload et, diğer adresi kullan, yeni bir link gönder                                    | Başarısız olan object, ardından bir control: toast'ta `action`, block'ta **Try again** |
| Tipik sebepler        | `400` · `401` · `403` · `404` · `409`, reddedilen bir credential, süresi dolmuş bir link                                                           | network · timeout · `429` · `5xx`                                                      |
| Örnek                 | You need admin access to change columns. Ask a workspace owner. (Column'ları değiştirmek için admin erişimi gerekir. Bir workspace owner'ına sor.) | The board couldn't load. → **Try again** (Board yüklenemedi. → **Yeniden dene**)       |

Sağdaki sütunu iki şey dürüst tutar. Her basışta yeniden başarısız olan bir control, kullanıcıya
ürünün bozuk olduğunu öğretir; bu yüzden **açıklanmış** bir failure asla control almaz — server'ın
`403` ile reddettiği bir write'ı, ya da artık var olmayan bir task'a yapılan bir write'ı yeniden
göndermek yalnızca toast'ı tekrarlar. Ve başarısız olan control **hâlâ ekrandaysa ve hâlâ
canlıysa** — bir dialog'un submit button'ı, "Load more", bir select — retry zaten odur; yanına bir
ikincisini koymak karmaşadır. Create/rename/delete dialog'larının kendi action'ını taşımamasının
sebebi budur.

Kullanıcıya görünen her string, MVP English-only ship etse bile, ilk component'ten itibaren
**next-intl** üzerinden geçer. Bu _layer_'dır, çeviriler değil: roadmap'in Beyond-MVP "i18n in
the application UI" ("uygulama UI'sinde i18n") satırı daha fazla language pack ship etmekle
ilgilidir, ve plumbing Faz 1 skeleton'uyla birlikte gelir çünkü onu sonradan eklemek, onunla
başlamaktan çok daha pahalıya mal olur.

| i18n kuralı                      |                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardcode edilmiş string yok      | JSX'te bir string literal bir lint error'dur. Server component'lerde `getTranslations`, client olanlarda `useTranslations`.                                   |
| Key'ler                          | Domain'e göre, component tree'yi mirror'layarak: `board.column.addAction`, `task.priority.urgent`, `errors.http.409`                                          |
| Kataloglar                       | `messages/en.json` kanoniktir; `messages/tr.json` onun yanında gelir ve `messages/catalog.test.ts`, birinde olup diğerinde olmayan bir key'de build'i düşürür |
| Plural'lar, interpolation        | ICU format (`{count, plural, …}`). Cümle parçalarını asla concat etme — word order dilden dile değişir.                                                       |
| Date'ler, sayılar, relative time | Aktif locale ile next-intl formatter'ları üzerinden `Intl.*`; elle formatlanmış date yok                                                                      |
| Casing                           | **Çevrilmiş string'lerde `text-transform: uppercase` yok** — Turkish `i → İ`, CSS casing altında bozuluyor. İstenen casing'i doğrudan kataloğa yaz.           |
| Layout                           | ±35% string uzunluğu varsay; İngilizcesi sığıyor diye hiçbir şey fixed pixel width olmasın                                                                    |

## 8. Grafikler ve dashboard

Dashboard için ([ROADMAP.md](../../ROADMAP.md#shipped-mvp-summary), Faz 7), Recharts ile render edilir. Form, herhangi bir renk
kararından önce, reader'ın job'ına göre seçilir. Asla dual bir y-axis, asla iki slice'ı geçen bir
pie, asla generate edilmiş bir dokuzuncu ton — tail'i "Other" ("Diğer") içine katla ya da small
multiple'lara facet'le.

| Aggregate                                        | Form                                                                                             | Renk görevi                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------- |
| Open task'lar, overdue count, bu hafta completed | **Stat tile** — label, value, adlandırılmış bir periyoda karşı signed delta, opsiyonel sparkline | none / emphasis                  |
| Zaman içinde completion                          | **Line**, tek series (yalnızca yalnızsa 10% area fill)                                           | sequential                       |
| Zaman içinde created vs completed                | **Two lines**, sağ kenarda direct-labeled                                                        | categorical 1–2                  |
| Column başına · assignee başına task             | **Horizontal bar**, sorted; assignee'ler top 8 sonra "Other" ("Diğer")                           | sequential                       |
| priority breakdown'ı                             | **Horizontal stacked bar**, tek satır, LOW→URGENT                                                | priority skalası (§3)            |
| Label distribution'ı                             | **Horizontal bar**                                                                               | categorical, label slot'una göre |
| Zaman içinde column composition'ı                | **Stacked area / column**, ≤ 6 series                                                            | categorical                      |
| Hepsi önemli olan ~7'den fazla category          | **Table**, ya da table artı chart                                                                | —                                |

Palette, Kurul'un kendi surface'lerine karşı validate edildi (`#FFFFFF` açık, `#161918` koyu).
Bu slot'lar aynı zamanda `Label.color`'ın arkasındadır.

| Slot | Ton     | Açık      | Koyu      |     | Slot | Ton     | Açık      | Koyu      |
| ---- | ------- | --------- | --------- | --- | ---- | ------- | --------- | --------- |
| 1    | mavi    | `#2A78D6` | `#3987E5` |     | 5    | macenta | `#E87BA4` | `#D55181` |
| 2    | turuncu | `#EB6834` | `#D95926` |     | 6    | yeşil   | `#008300` | `#008300` |
| 3    | turkuaz | `#1BAF7A` | `#199E70` |     | 7    | mor     | `#4A3AA7` | `#9085E9` |
| 4    | sarı    | `#EDA100` | `#C98500` |     | 8    | kırmızı | `#E34948` | `#E66767` |

Validator — **açık**: lightness band, kroma, CVD (worst adjacent ΔE 9.1) ve normal-vision (19.6)
hepsi PASS; slot 3/4/5'te beyaz üzerinde 3:1'in altında contrast WARN, bu yüzden o slot'lar
nerede görünürse görünsün **direct label'lar veya table view zorunludur**. **Koyu**: altı check
de PASS, worst adjacent CVD ΔE 8.4.

| Kural                    |                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Slot ataması             | Fixed order, sırayla assign edilir, **asla cycle'lanmaz**. Renk, rank'ini değil entity'yi takip eder — bir series'i filtrelemek, kalanları repaint etmemeli.                                                                                                                                     |
| Series cap'i             | Bar'lar, line'lar, stack'ler için 6 soft / 8 hard; scatter, bubble ve small multiple'lar için **3** (all-pairs gate)                                                                                                                                                                             |
| Sequential · diverging   | Magnitude için tek bir ton, mavi, açık→koyu · **neutral gray** (`#F0EFEC` / `#383835`) midpoint'li mavi ↔ kırmızı, yalnızca "vs target" view'ları için                                                                                                                                           |
| Emphasis                 | `--signature` bakırında tek bir series, kalanı `--foreground-disabled`'da. Bir chart'taki tek bakır, ve story "this one" ("bu") olduğunda doğru cevap.                                                                                                                                           |
| status ve priority       | Reserved — asla "series 4" olarak reuse edilmez                                                                                                                                                                                                                                                  |
| Mark'lar                 | Bar'lar ≤ 24px kalınlığında, 4px rounded data-end, baseline'da square, adjacent bar'lar ve stacked segment'ler arasında 2px surface-colored gap; line'lar 2px round cap/join; marker'lar ≥ 8px, 2px'lik bir surface ring'iyle                                                                    |
| Grid ve axis'ler         | Yalnızca horizontal gridline, 1px solid `--border`, asla dashed değil. Chart border yok, background fill yok. Tick'ler temiz sayılara rounded, thousands-separated, `tabular-nums`, `--muted-foreground`'da.                                                                                     |
| Legend ve label'lar      | 2+ series'te legend her zaman var, tek series'te yok — title onu zaten adlandırıyor. Direct label'lar selective'tir (endpoint, extreme, ya da story olan tek series), asla her point'te bir sayı değil. **Metin text token giyer, asla series ton'unu değil**; identity yanındaki dot'tan gelir. |
| Tooltip                  | Default-on: line ve area'da crosshair + tooltip, bar ve cell'de per-mark. Card surface, 1px border, `sm` radius, 8px padding, series dot'u + name + `tabular-nums` value, mark'tan daha büyük bir hit target.                                                                                    |
| Filter'lar ve table view | Filter'lar chart'ların üzerinde tek bir satırda, asla bir chart'ın içinde değil. Her chart'ın bir "View as table" ("Tablo olarak görüntüle") affordance'ı var — aynı zamanda light-mode contrast WARN'ı için relief channel.                                                                     |

**Stat tile'lar.** `small` `--muted-foreground`'da label, sentence case, sondan colon yok ·
**proportional** figure'larla, auto-compacted (`1,284` / `12.9K`) 28px'te Archivo 600'de value ·
adlandırılmış bir periyoda karşı signed delta, _direction × whether up is good_'a göre renklenir
(daha fazla overdue task iyi haber değildir) ve bir arrow'la eşleşir · `--foreground-disabled`'da
opsiyonel 12-point sparkline, current period bakırda. **View başına en fazla bir hero figure**,
≥48px, Archivo'da — asla Fraunces'te; bir sayının üzerindeki bir display face, dekorasyon gibi
okunur.

## 9. Erişilebilirlik

Her iki temada da **WCAG 2.1 AA**'yı hedefle, screenshot başına değil token pair'i başına
verify edilmiş olarak.

| Gereksinim                               | Taban                                    | Uygulandığı yer                                                       |
| ---------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| Kendi surface'i üzerinde body metni      | 4.5:1                                    | §3'teki her foreground/surface çifti — hepsi tabanın üzerinde ölçüldü |
| Büyük metin (≥18.66px bold / 24px)       | 3:1                                      | Title'lar, hero figure'lar                                            |
| Component sınırları ve state'leri        | 3:1                                      | Input border'ları, focus ring, sancak rail'i, chart mark'ları         |
| Disabled metin                           | muaf, yine de 3:1'e tutulur              | Placeholder'lar, disabled control'ler                                 |
| Chart surface'i üzerinde chart mark'ları | 3:1, ya da direct label'lar / table view | Açık slot 3, 4, 5 relief route'unu alır                               |

| Kural                       |                                                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Klavye paritesi             | Her pointer etkileşiminin bir klavye yolu vardır, drag and drop dahil (§5). Bir feature yalnızca drag ile yapılabiliyorsa, bitmemiş demektir.                                                                                                                      |
| Renk asla tek başına değil  | priority ve status bir ikon ve bir kelimeyle ship edilir; label'lar isimlerini chip'te taşır; series'ler bir legend alır ve ≤4 series'te direct label alır; rail'e `aria-current` ve bir weight değişimi eşlik eder                                                |
| Focus yönetimi              | Non-modal panel, açılışta focus'u kendi heading'ine taşır ve kapanışta onu originating card'a geri döndürür, trap etmeden. Dialog'lar _gerçekten_ trap eder, kapanışta focus'u restore eder ve `Esc`'te kapanır; popover'lar focus'u trigger'larına geri döndürür. |
| Announcement'lar            | Drag transition'ları, optimistic failure'lar, realtime arrival'lar ve toast'lar `aria-live="polite"` üzerinden geçer; yalnızca session'ı bitiren bir error `assertive`'dir                                                                                         |
| Reduced motion              | Her yerde respect edilir ve bir state değişimini asla kaldırmaz — state yine değişir, yalnızca hareket etmeyi bırakır                                                                                                                                              |
| Structure                   | Route başına bir `h1`; sidebar, main, panel için landmark; labelled composite widget olarak board; text olarak expose edilen column count'ları, infer edilmeyen                                                                                                    |
| Zoom, reflow, forced colors | 200%'de kullanılabilir — board iki yönde scroll olmak yerine sidebar collapse olur ve panel bir sheet'e dönüşür. `forced-colors: active`, border'ları ve focus ring'leri korur; chart'lar table view'a fallback eder.                                              |

## 10. Çapraz referanslar

| Doküman                                                                | Burada neyi bağlıyor                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [coding-standards.md](coding-standards.md#nextjs-appsweb)              | `components/ui/` yalnızca shadcn output'udur — token'lar theme'de edit edilir, asla bir primitive'de değil; component'lerde arbitrary hex yok; conditional class'lar `cn()` üzerinden |
| [architecture.md](architecture.md#4-appsweb--yapı)                     | Bu dokümanın ortaya koyduğu `(auth)` / `(app)` route group'ları ve `board/`, `task/`, `dashboard/`, `layout/` component domain'leri                                                   |
| [api-conventions.md](api-conventions.md#hatalar)                       | Error metninin türediği problem-JSON şekli, ve `statusCode` üzerinden branch'leme kuralı                                                                                              |
| [Sevkedilen MVP özeti](../../ROADMAP.md#shipped-mvp-summary)           | Faz 3 token'ları, shell'i ve board chrome'unu getirir; Faz 4 drag etkileşimini ve detay panelini; Faz 5 priority ve label render'ını; Faz 7 grafikleri                                |
| [`decisions/0003-frontend-stack.md`](decisions/0003-frontend-stack.md) | Next.js 16 + Tailwind + shadcn/ui + @dnd-kit + Recharts — yukarıdaki her kuralın karşısında yazıldığı toolkit                                                                         |
| [tech-stack.md](tech-stack.md)                                         | Neden o toolkit                                                                                                                                                                       |
