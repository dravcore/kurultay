# Test

Kurul'un neyi, hangi araçlarla test ettiği ve CI'ın neyi zorunlu kıldığı.

> 🌐 [English (canonical)](../testing.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [Strateji](#strateji)
- [Piramit](#piramit)
- [Neler test edilmeli](#neler-test-edilmeli)
- [Browser uçtan uca](#browser-uçtan-uca)
- [Dosya konvansiyonları](#dosya-konvansiyonları)
- [Testleri çalıştırma](#testleri-çalıştırma)
- [Test yazma](#test-yazma)
- [Coverage](#coverage)
- [CI](#ci)

## Strateji

Kurul’ın MVP özellik seti tamamlandı; test stratejisi bilinçli olarak **kapsamlı değil,
pragmatik** kalır:

- **Doğru yapması zor** ve **yanlış yapması pahalı** olan mantığı test edin — sıralama,
  tenant izolasyonu, auth.
- API'yi mock'lanmış bir Prisma client'a karşı değil, **gerçek bir PostgreSQL'e karşı**
  test edin. Bu aşamada yakalanmaya değer çoğu bug TypeScript'te değil, sorguda yaşıyor.
- Bir coverage sayısının peşinden **koşmayın**. Yalnızca implementasyonu yeniden ifade eden
  testler yazmayın.
- Browser e2e **yedi akışı kapsar, bilinçli olarak daha fazlasını değil** — stack'in ya
  tuttuğu ya da tutmadığı akışlar. Bkz. [Browser uçtan uca](#browser-uçtan-uca).

Bir testin maliyeti onu yazmak değildir — her refactor boyunca onu bakımda tutmaktır.
Testler, bu maliyetin gerçek güven satın aldığı yerlerde yazılır.

## Piramit

| Katman          | Araç                                   | Kapsam                                                                                               | Durum                                                |
| --------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Unit**        | Jest (`apps/api`), Vitest (`apps/web`) | Servisler, guard'lar, saf fonksiyonlar, board/izin logic'i, DnD hook'ları. Bağımlılıklar mock'lanır. | Baştan itibaren zorunlu                              |
| **Integration** | Jest + Supertest                       | HTTP request → controller → service → **gerçek Postgres** (`docker-compose.dev.yml` üzerinden)       | Her endpoint için zorunlu                            |
| **E2E**         | Playwright                             | Tam stack üzerinde browser akışları                                                                  | Yedi senaryo (`e2e/`) — her gece ve her sürüm öncesi |

```
        /\        e2e — yedi kritik akış (Playwright, gerçek Chromium)
       /  \
      /────\      integration — her endpoint (Supertest + gerçek Postgres)
     /      \
    /────────\    unit — servisler, guard'lar, saf logic (Jest), web logic/hook'ları (Vitest)
```

Tam component-tree render testleri MVP'nin parçası değil. Web unit testleri saf logic'i
(`lib/*.test.ts` — izinler, position matematiği, mention'lar, query parametreleri) ve board
drag-and-drop hook'unu izole şekilde kapsar; geri kalan her şey için yapılan takas tip
güvenliği artı API'nin integration coverage'ı; board'un kendi davranışını ise parça parça
component testleri değil, aşağıdaki yedi browser senaryosu uçtan uca kapsar.

## Neler test edilmeli

Bu üç alan pazarlığa açık değildir. Bunlara dokunan ama testsiz bir PR merge edilmez.

### 1. Fractional indexing (`Task.position`)

`Task.position` bir `Float`'tır ve tüm drag-and-drop sıralama modeli buna bağlıdır.
Kapsanması gereken durumlar:

| Durum                                         | Beklenti                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| İki kart arasına ekleme                       | Yeni position, komşuların kesin arasındadır                                          |
| Bir column'un en üstüne ekleme                | Position, mevcut ilkinden küçüktür                                                   |
| En alta ekleme                                | Position, mevcut sonuncudan büyüktür                                                 |
| Boş bir column'a ekleme                       | Geçerli bir başlangıç position'ı üretilir                                            |
| Aynı column içinde taşıma                     | Yalnızca taşınan satır güncellenir                                                   |
| Column'lar arası taşıma                       | Hem `columnId` hem `position` güncellenir; başka hiçbir satır değişmez               |
| Aynı boşluğa (gap) tekrarlanan eklemeler      | Float precision tükenmez; boşluk çok küçülürse column yeniden dengelenir (rebalance) |
| Aynı boşluğa eşzamanlı (concurrent) taşımalar | İki task aynı position'da bitmez, ya da çakışma deterministik olarak çözülür         |

Precision tükenmesi ve concurrency durumları production'da gerçekten kırılan durumlardır.
Bunları ima yoluyla değil, açıkça test edin.

### 2. Workspace izolasyonu

Her sorgu `workspaceId` ile scope'lanır. Bu multi-tenancy garantisi ve bir güvenlik
sınırıdır, dolayısıyla öyle test edilir:

- Workspace A'nın bir üyesinin bir workspace B kaynağı isteği **404** alır (403 değil —
  kaynağın var olduğunu doğrulamayın).
- İç içe route'lar tüm zinciri doğrular: bir task, URL'deki workspace'e ait bir board'a ait
  olmalıdır.
- Liste endpoint'leri, bir filtre veya arama terimi onlarla eşleşse bile başka bir
  workspace'ten satır asla döndürmez.
- Rol kontrolleri: `OWNER`/`ADMIN`/`MEMBER`/`GUEST`'in her biri en az bir izin verilen ve
  bir reddedilen durumu hit eder.

İzolasyon kuralı tip sistemi yerine bir guard tarafından zorlandığından, bu testler onun
tek mekanik zorlaması olur.

### 3. Auth akışları

- Kayıt, giriş, çıkış, session yenileme
- Korunan bir route'a kimliksiz istek → **401**
- Süresi dolmuş veya kurcalanmış session → **401**
- Davet kabulü, tam olarak amaçlanan rolü verir

## Browser uçtan uca

Browser e2e MVP boyunca ertelendi ve gerekçesi geçerliydi: board UI'ı haftalık şekil
değiştiriyordu, o dönemde yazılmış bir suite üç kez yeniden yazılırdı. Ertelemenin geride
bıraktığı şey başka hiçbir katmanın kapatamayacağı bir boşluktu — bu ürünü ürün yapan
akışlar binden fazla unit testi ve her endpoint için bir integration testiyle doğrulanıyordu
ve **bir kez bile gerçek bir tarayıcıda değil**. İki suite de hiç render olmayan bir board
ile yeşil kalır.

Suite [`e2e/`](../../e2e) altında yaşar, derlenmiş bir API ve production web build'i
üzerinde gerçek bir Chromium koşturur, ve tam olarak yedi senaryodur. Dört senaryoyla başladı ve
yalnızca stack seviyesindeki bağlantısına başka hiçbir şeyin ulaşamadığı özelliklerle büyüdü —
gerçek bir tarayıcıdan gelen gerçek bir multipart yükleme, importer'ı besleyen gerçek bir dosya
seçici, ve jsdom'da hiçbiri var olmayan bir viewport, bir dokunmatik ekran ve layout edilmiş bir
belge.

### Yedi senaryo

| Senaryo                                                                            | Dosya                                  | Tek başına neyi kapsar                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Giriş → board aç → kart sürükle → **reload sonrası hâlâ yeni sırada**              | `tests/board-drag-persistence.spec.ts` | Tarayıcıdaki pointer hareketinin move isteğini gerçekten üretmesi ve board'un yazdığını geri okuması                                                                                                                                       |
| Bir tarayıcıdaki taşıma **ikinci tarayıcıda** reload olmadan görünür               | `tests/board-realtime.spec.ts`         | Socket.io handshake auth'u, board-room üyeliği, ve client'ın yalnızca id taşıyan payload'ı uygulaması                                                                                                                                      |
| Ayarlar'dan davet → **Mailpit'te postayı oku** → linkten kabul et                  | `tests/invitation.spec.ts`             | Davet postasının gönderildiği ve çalışan bir link taşıdığı — `acceptUrl` `WEB_URL`'den üretilir, API'nin kendi testleri DTO'ya bakar, gövdeye değil                                                                                        |
| Bildirime tıkla → **doğru task açılır**                                            | `tests/notification.spec.ts`           | Bildirimde `taskId` var ama `boardId` yok; board'u web ikinci bir istekle, tarayıcıda, alıcının session'ıyla çözer                                                                                                                         |
| Karta dosya yükle → **geri indir ve baytları karşılaştır**                         | `tests/task-attachment.spec.ts`        | API suite'inin değil, Chromium'un yazdığı bir multipart gövde; ASCII olmayan bir dosya adının hem yükleme kodlamasından hem `Content-Disposition`'dan sağ çıkması; board kartındaki sayaç rozeti — panelinkinden farklı bir sorgudan gelir |
| Dosya seçiciden Trello export'u import et → **raporu ekranda oku**                 | `tests/board-import.spec.ts`           | API'nin kendisi hiç üretmediği boundary'yi üreten gerçek bir `<input type="file">`, ve import raporunun ekrana ulaşması — rapor yalnız `201`'in gövdesinde vardır, dolayısıyla onu düşüren bir panel tek kopyayı düşürür                   |
| **360px'te dokunmatik board** — drawer, 44px hedefler, column scroll'u, touch drag | `tests/mobile-navigation.spec.ts`      | Bir genişlikteki yerleşim, ve parmaktan gelen input. jsdom hiçbir şeyi layout etmez, bu yüzden bir Vitest testindeki her kutu ölçümü sıfırdır; `hasTouch` / `isMobile` ise unit testin karşılığı olmayan context seçenekleridir            |

Bu yedisinin dışındaki her şey unit ya da integration testine aittir. Buraya eklenen her test,
bir UI refactor'ü boyunca yeşil tutulacak bir şey daha demektir; bu suite alt katmanların
zaten kapsadığını tekrar kontrol etmek için değil, **stack** dağıldığında bunu fark etmek
için vardır.

### Çalıştırma

Postgres **ve Mailpit** ayakta olmalı (`docker compose -f docker-compose.dev.yml up -d`);
Mailpit olmadan yedi senaryonun üçü adresini doğrulayamaz veya daveti okuyamaz. Redis
gerekmez — suite'in onsuz koşmasının nedeni için [İzolasyon](#i̇zolasyon) bölümüne bakın.

```bash
pnpm --filter @kurul/e2e browsers   # bir kez: Chromium'u indirir
pnpm test:browser                      # stack'i build eder, sonra yedisini de koşar
```

`pnpm test:browser` önce `e2e/build-stack.mjs`'i çalıştırır — `shared-types`, `auth-access`,
API ve standalone web bundle'ını build eder, ardından suite'in veritabanını migrate eder. İki
sunucuyu Playwright kendi başlatıp durdurur. Build etmeden bir test üzerinde çalışmak için
doğrudan `pnpm --filter @kurul/e2e exec playwright test` koşun; yerelde zaten dinleyen bir
stack'i yeniden kullanır.

**Web build'i `pnpm build` ile birbirinin yerine geçmez.** `NEXT_PUBLIC_API_URL` build
zamanında gömülür, yani suite'in build'i client bundle'ına 4110 portunu sabitler ve
`apps/web/.next`'in üzerine yazar. Suite'i yerelde koştuktan sonra
`pnpm --filter @kurul/web start` kullanmadan önce yeniden build edin.

### İzolasyon

Suite, halihazırda çalışan neyse onun yanına uygulamanın ikinci bir kopyasını açar ve ona
asla dokunmaz:

| Şey                | Değer                   | Neden                                                                            |
| ------------------ | ----------------------- | -------------------------------------------------------------------------------- |
| Web / API portları | 3110 / 4110             | 3000/4000 `pnpm dev`'in                                                          |
| Veritabanı         | `kurul_test_playwright` | `kurul_test` değil — Jest integration suite'i onu testler arasında truncate eder |
| Redis              | yok — `REDIS_URL` boş   | Aşağıya bakın; Redis'siz koşmak desteklenen bir yapılandırmadır                  |
| Posta              | paylaşılan Mailpit      | Hiçbir şey silinmez; her arama suite'in ürettiği bir adrese göre daraltılır      |

Bunların hiçbiri `.env` üzerinden ayarlanabilir değil ve hiç yeni environment değişkeni
eklemiyor: Postgres _bağlantısı_ `DATABASE_URL`'den, yalnızca veritabanı adı değiştirilerek
türetilir. Buradaki yanlış ayarlanmış bir değişken, suite'in sessizce geliştirme veritabanına
karşı koşması demek olurdu — bu düzenin imkânsız kılmak için var olduğu tek hata da budur.
Gerekçe `e2e/stack-env.ts` içinde yazılı.

**Neden Redis yok.** Bariz sınır bir logical database indeksiydi ve bir zamanlar kurgudan
ibaretti: `parseRedisUrl` URL'in pathname'ini düşürüyordu ve `apps/api`'deki her ioredis/BullMQ
kurulumu oradan geçtiği için `redis://…/8` database 0'a bağlanıyordu
(issue [#190](https://github.com/dravcore/kurul/issues/190)). Bu düzeldi — indeks artık her
tüketiciye ulaşıyor — ama bir _keyspace_ ayırıyor, kanal değil: Redis pub/sub veritabanını
yok sayar, dolayısıyla Socket.io fan-out kanalı, hangi indeksi seçmiş olursa olsun o sunucunun
tüm istemcileri arasında paylaşılır; anahtar öneki de kullanılabilir değil, çünkü BullMQ'nun
prefix'i ve adaptörün kanal adları `apps/api` kaynağında seçiliyor. Yani bir indeks, asıl canımızı
yakan kısmı — `due-soon` _kuyruğunu_ paylaşan iki API instance'ı sırayla birbirinin zamanlanmış
taramalarını yanlış veritabanına karşı koşar — ayırırdı; bedeli ise adaptörü ve worker'ı suite'in
içinde başlatmak olurdu ki bu, varsayımla geçiştirilecek değil kendi doğrulamasını hak eden bir
davranış değişikliğidir. O zamana kadar suite Redis'siz koşuyor ve API bunu doğrudan destekliyor:
readiness Redis'i `skipped` raporluyor, gateway adaptörün bağlanmadığını logluyor, due-soon
worker'ı başlamayı reddediyor. Tek bir API süreciyle adaptör mesajları yalnızca kendi yayıncısına
geri dağıtacağından test edilen hiçbir şey kapsam kaybetmiyor. Veritabanı indeksinin kendisi ise
ait olduğu yerde, canlı bir sunucuya karşı, `apps/api/test/redis-database-index.e2e-spec.ts`
içinde kapsanıyor.

### Bu testler nasıl yazılır

- **Kurulum HTTP üzerinden, davranış UI üzerinden.** Hesaplar, workspace'ler, board'lar ve
  kartlar API çağrılarıyla yaratılır; yalnızca test edilen davranış tıklanır. Kurulumu da
  tıklayarak yapmak her senaryoyu aynı zamanda kayıt ve workspace yaratma testine çevirirdi;
  o zaman tek bir değişiklik hepsini birden kırar ve hiçbiri doğru bir şey söylemezdi.
- **`data-testid` yok.** Bu uygulamanın production kodunda bir tane bile yok ve suite de
  eklemiyor. Kolonlar `<section aria-label>`, kartların tutamağında
  `aria-label="Reorder <title>"` var — erişilebilir yüzey üzerinden assert etmek, ekran
  okuyucu kullanıcısını kıran bir değişikliğin bu suite'i de kırması demektir.
- **Hiçbir yerde sabit bekleme yok.** Sadece `expect.poll` ve web-first assertion'lar. Bir
  `sleep` ya en meşgul makinede çok kısadır ya da diğer her koşuda boşa harcanan zamandır.
- **CI dahil, retry yok.** Retry bir flake'i yeşil koşuya çevirir; bir suite'in anlamını
  yitirmesinin en hızlı yolu budur.
- **`Task.position`'a asla assert etmeyin.** O, fractional indexing'in ürettiği bir Float'tır
  ve rebalancing onu her an değiştirebilir. Sözleşme _sıradır_.
- **Reload'dan önceki bir drop assertion'ı hiçbir şey kanıtlamaz.** Board taşımayı optimistik
  uygular, yani bir şey kalıcılaşsa da kalıcılaşmasa da ekrandaki sıra değişir. Test,
  reload'un kendisidir.

### Testin kırmızıya dönebildiğini kanıtlayın

Geçen bir browser testi hakkında yanılmak alışılmadık ölçüde kolaydır: `await` edilmemiş bir
assertion her zaman yeşildir, ve bir senaryo saklanan durum yerine sessizce optimistik UI'a
assert ediyor olabilir. Bir senaryo bitmiş sayılmadan önce **koruduğu şeyi bozun ve kırmızıya
dönmesini izleyin.** İlk dördü tam olarak böyle kontrol edildi — position PATCH'i,
`task:moved` emit'i, davet postasındaki kabul linki ve bildirimin yönlendirme hedefindeki
task segmenti sırayla kaldırıldı. O dördünün üçü son assertion'a kadar geçmeye devam etti;
mesele de bu: o son assertion testin kendisidir.

Sonradan eklenen iki senaryo aynı garantiyi ikinci bir biçimde taşıyor, çünkü onu sürdürmek daha
ucuz: **her olumlu assertion, kendisinden önce gelen olumsuzuyla eşleştirilmiş durumda.** Ek
listesinin boş durumu yüklemeden önce assert ediliyor ve kart rozeti var olduğu assert edilmeden
önce yok olduğu assert ediliyor; board listesinin boş durumu import'tan önce assert ediliyor ve
rapor bölgesi görünür olduğu assert edilmeden önce gizli olduğu assert ediliyor. Özellik tamamen
sökülse bile geçmeye devam edecek bir senaryo, bu bölümün önlemek için var olduğu şeydir; bir
yokluğu assert etmek de bunu olası değil, imkânsız kılar.

## Dosya konvansiyonları

| Tür                          | Konum                               | Desen                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit                         | Kaynak dosyayla yerinde (colocated) | `apps/api/src/task/task.service.spec.ts`                                                                                                                                                                                                                                                         |
| Integration                  | Ayrı bir test kökü                  | `apps/api/test/task.e2e-spec.ts`                                                                                                                                                                                                                                                                 |
| Test helper'ları/factory'ler | Test kökü altında paylaşılır        | `apps/api/test/helpers/`, `apps/api/test/factories/`                                                                                                                                                                                                                                             |
| Geçici depolama kökü         | Veritabanı helper'ının yanında      | `apps/api/test/helpers/storage.ts`                                                                                                                                                                                                                                                               |
| Girdi fixture'ları           | Test kökünde, kaynağına göre        | `apps/api/test/fixtures/trello/` — elle yazılmış Trello export'ları; hem unit hem entegrasyon testleri okur, ayrıca `real/` altında iki anonimleştirilmiş gerçek export; dizinin kendi README'si hangisinin hangisi olduğunu kayda geçirir ([ADR 0025](decisions/0025-trello-import-mapping.md)) |
| Browser e2e                  | Repository seviyesinde paket        | `e2e/tests/board-realtime.spec.ts`                                                                                                                                                                                                                                                               |
| Browser e2e helper'ları      | Onların yanında                     | `e2e/support/`, `e2e/stack-env.ts`                                                                                                                                                                                                                                                               |

Nest'in generator'ı integration testlerini `*.e2e-spec.ts` olarak adlandırıyor; bunlar
browser e2e değil API integration testleri olsa da bu isim tooling uyumluluğu için
korunuyor.

**Gerçek Trello export'ları.** `apps/api/test/fixtures/trello/real/` dizininde
`scripts/anonymise-trello-export.mjs` betiğinden geçmiş gerçek export'lar durur (yapı bayt bayt
korunur, her metin parçası aynı uzunlukta bir takma adla değiştirilir) — 2026-08-22 itibarıyla iki
tane: Trello'nun kendi varsayılan "Starter Guide" panosu ve on bir listeli bir pano.
`trello-import-real.e2e-spec.ts` oradaki her `*.json` dosyasını gerçek endpoint üzerinden import
eder ve raporu ile veritabanını dosyadan türetilen sayılarla karşılaştırır; ikisi de temiz şekilde
import ediliyor, okuyucunun kullandığı hiçbir alanda sentetik fixture'larla fark çıkmadı
([`fixtures/trello/README.md#field-mapping-diffs`](../../apps/api/test/fixtures/trello/README.md#field-mapping-diffs)).
Dizin bir gün yeniden boşalırsa spec tam olarak bir atlanmış test bildirir,
`no anonymised real Trello exports in fixtures/trello/real yet (v0.3.0 gate)`, böylece açık kapı
CI'da görünür kalır. Anonimleştiricinin kendi unit testleri `pnpm test:scripts` ile `node:test`
üzerinde çalışır, çünkü `scripts/` dizininin bağımlılığı yoktur; aynı spec, anonimleştirilmiş bir
export'un orijinaliyle birebir aynı şekilde import edildiğini sentetik fixture üzerinde de kanıtlar.

## Testleri çalıştırma

```bash
# Integration testler için servisler ayakta olmalı
docker compose -f docker-compose.dev.yml up -d

pnpm --filter @kurul/api test          # api unit
pnpm --filter @kurul/api test:watch    # api unit, watch modu
pnpm --filter @kurul/api test:e2e      # integration (Postgres gerektirir)
pnpm --filter @kurul/api test:cov      # api coverage raporu

pnpm --filter @kurul/web test          # web unit (Vitest)
pnpm --filter @kurul/web test:watch    # web unit, watch modu

pnpm test:scripts                         # scripts/ (node:test, bağımlılık yok)

pnpm test:browser                         # browser e2e (Mailpit de gerekir)
```

Integration testler, test setup'ı tarafından oluşturulan ve migrate edilen **ayrı bir
veritabanına** (`kurul_test`) karşı çalışır. Geliştirme veritabanına asla dokunmazlar.
Browser suite'i üçüncü bir veritabanı kullanır — bkz. [İzolasyon](#izolasyon).

Bu komutların hiçbiri `packages/*/dist` gerektirmez. İki Jest config'i ve Vitest config'leri
`@kurul/shared-types` ile `@kurul/auth-access` paketlerini `src/index.ts` dosyalarına eşler;
böylece suite'ler `pnpm typecheck`'in okuduğu kaynağı derler ve bayat bir build'e karşı
geçemez. `apps/api/src/workspace-packages.spec.ts`, `apps/api/test/harness.e2e-spec.ts` ve
`apps/web/workspace-packages.test.ts` bu eşleme kaldırılırsa kırmızıya döner. Build hâlâ
`pnpm typecheck`, `nest build`, `next build` ve `pnpm dev` için gereklidir, bkz.
[development.md](development.md#klonlama-ve-kurulum).

## Test yazma

- **Arrange–Act–Assert**, üç kısım arasında boş satırlarla.
- Test isimleri metot isimlerini değil davranışı tarif eder:
  `it('returns 404 when the board belongs to another workspace')`, `it('findOne works')`
  değil.
- Test başına bir davranış. İsim "ve" gerektiriyorsa, bölün.
- Entity'ler için factory/builder kullanın; aynı 15 alanlı task literal'ini yirmi testte
  elle yazmayın.
- **Her integration testi kendinden sonra temizlik yapar** — etkilenen tabloları
  `afterEach`'te truncate edin ya da testi geri alınan (rolled back) bir transaction
  içine sarın. Sıraya bağımlı test suite'leri bir bug'dır. **Geçici dizin de state sayılır**:
  depolamaya dokunan bir spec kendi kökünü `createTempStorageDir()` ile açar ve `afterEach`'te
  `removeTempStorageDir()` ile siler (`test/helpers/storage.ts`) — `helpers/db.ts`'in satırlar
  için cevapladığı aynı sorunun cevabı.
- **Depolama gerçek bir dizine karşı test edilir, asla memory backend'e karşı değil.** ADR 0022
  bellek içi bir `StorageBackend`'i, bu dosyanın integration testlerinde Prisma mock'lamayı
  yasaklamasıyla aynı gerekçeyle reddetti: yalnız testler için var olan bir sınıf olurdu ve kod
  tabanında bunun emsali yok — ona en yakın şey olan `LogMailSender` aynı zamanda bir üretim
  geri düşüşü. Yol işleme, izinler ve okuma akışı yolunu test edilebilir kılan şey gerçek bir
  dosya sistemine yazmaktır; sahte bir backend'in yapısı gereği zaten doğru yapacağı üç şey de
  tam olarak bunlardı.
- Yalnızca kontrol etmediğiniz bir process sınırını geçen şeyleri mock'layın (email,
  üçüncü parti HTTP). Integration testlerinde Prisma'yı mock'lamayın — onların amacı tam
  olarak bu. Browser suite'i hiçbir şeyi mock'lamaz, postayı da: gönderileni Mailpit'ten okur.
- `setTimeout` tabanlı bekleme yok. Şeyin kendisini await edin.
- Bir bug fix'i, fix'ten önce başarısız olan bir regresyon testiyle birlikte gelir.

## Coverage

**Coverage önce bir sinyaldir.** Repo genelinde bir hedef yoktur ve bir sayıyı kendisi için
yükseltme arzusu da yoktur.

- Raporu, hiçbir testin çalıştırmadığı kodu bulmak için kullanın, sonra o kodun bir test
  _hak edip etmediğine_ karar verin.
- Bir positioning algoritmasında düşük coverage bir problemdir. Bir DTO'da veya bir barrel
  dosyasında düşük coverage değildir.
- Assertion'sız testlerle bir eşiği kandırmak, eşiğin hiç olmamasından daha kötüdür. Bu
  yüzden taban değerler yalnızca zaten anlamlı biçimde test edilmiş koda uygulanır; bir
  ortalamayı yukarı çekmek için asla global olarak konmaz.

### Taban değerlerin bulunduğu yerler

Zaten kapsanmış kodun geri kaymasını mandallar engeller. Hepsi CI'ı kırar.

| Kapsam                                  | Taban değer                                           | Nerede tanımlı              |
| --------------------------------------- | ----------------------------------------------------- | --------------------------- |
| `apps/api` global                       | statements 75 / branches 66 / functions 77 / lines 76 | `apps/api/jest.config.cjs`  |
| `apps/web` `app/**`                     | statements 85 / branches 90 / functions 85 / lines 85 | `apps/web/vitest.config.ts` |
| `apps/web` `components/board/**`        | statements 65 / branches 54 / functions 54 / lines 70 | `apps/web/vitest.config.ts` |
| `apps/web` `components/task/**`         | statements 60 / branches 60 / functions 58 / lines 62 | `apps/web/vitest.config.ts` |
| `apps/web` `components/layout/**`       | statements 75 / branches 65 / functions 85 / lines 78 | `apps/web/vitest.config.ts` |
| `apps/web` `components/notification/**` | statements 91 / branches 83 / functions 95 / lines 93 | `apps/web/vitest.config.ts` |
| `apps/web` `lib/**`                     | statements 91 / branches 83 / functions 93 / lines 92 | `apps/web/vitest.config.ts` |

Hepsi konuldukları anda alınan ölçümün birkaç puan altındadır — rutin bir refactor'ın
takılmayacağı kadar pay bırakan, ama bir testin silinmesini yakalayacak kadar dar.

`apps/web`'in **global bir taban değeri yoktur**, bilinçli olarak. Genel web coverage son
koşularda instrumented statement'ların ~%83'ü civarındadır ama bu ortalama hâlâ yoğun testli
hook'ları ince sayfa kabuklarıyla karıştırır; ortalamada bir global taban az şey yakalar.
Klasör tabanları anlamlı unit testleri olan yüzeyleri kapsar: route girişleri (`app/**`),
etkileşimli board / task / layout / notification bileşenleri ve onların arkasındaki `lib/**`
yardımcıları. `apps/web/vitest.config.ts` tam gerekçeyi satır içinde taşır.

**Bir klasör tabanının yakalamadığı şey.** Coverage, diskteki her dosya için değil, bir testin
_import ettiği_ dosyalar için raporlanır. Bir modülü import eden son testi silmek bu yüzden
yüzdeyi düşürmez, modülü paydadan çıkarır ve taban yeşil kalır. Tabanlar bir testin
zayıflatılmasını yakalar, bir modülün terk edilmesini değil; ikincisi code review'ın işidir.
`components/notification/**` tabanında ölçüldü: `notifications-list.test.tsx` içindeki
click-through testlerini çıkarmak tabanı dört yönden kırıyor
(91 / 83 / 95 / 93'e karşı 75.00 / 66.35 / 71.18 / 80.11), ama o dosyanın tamamını silmek
geçiyor.

Global duruş, API'nin repo genelinde bir taban değerin anlamlı olacağı kadar kararlı olduğu
1.0'da yeniden gözden geçirilir.

Her iki suite de HTML/JSON raporlarını her koşuda — geçse de kalsa da — CI artifact'ı olarak
yayımlar (`api-coverage`, `web-coverage`).

## CI

Her pull request, `develop` ve `main` üzerinde de olduğu gibi şunları çalıştırır:

| Adım                   | Komut                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Shared paket build     | `pnpm --filter @kurul/shared-types build && pnpm --filter @kurul/auth-access build`                                 |
| Lint                   | `pnpm lint`                                                                                                         |
| Format kontrolü        | `pnpm format:check`                                                                                                 |
| Typecheck              | `pnpm typecheck` (workspace'ler genelinde `tsc --noEmit`)                                                           |
| Audit                  | `pnpm audit --audit-level high`                                                                                     |
| Unit testler (api)     | `pnpm --filter @kurul/api test:cov`                                                                                 |
| Unit testler (web)     | `pnpm --filter @kurul/web exec vitest run --coverage`                                                               |
| Unit testler (pkgs)    | `pnpm --filter "./packages/*" test`                                                                                 |
| Unit testler (scripts) | `pnpm test:scripts`                                                                                                 |
| Integration testler    | Postgres ve Redis service container'larına karşı `pnpm --filter @kurul/api test:e2e`                                |
| Build                  | `pnpm build`                                                                                                        |
| Imaj build + tarama    | Yayımlanan üç imaj, ardından her birine Trivy (aşağıya bakın)                                                       |
| **Kapı** (zorunlu)     | `ci-ok` — tüm upstream job'lar (`lint`, `test`, `build`, `image-scan`) başarıysa geçer (atlanmamış/iptal edilmemiş) |

**Merge öncesi tüm adımlar geçmelidir.** Kapı job'ı (`ci-ok`) branch korumasında yapılandırılan
tek zorunlu status kontrol — eğer herhangi bir upstream job başarısızsa, atlanırsa ya da iptal
edilirse, kapı başarısız olur. Bu iki koruma sağlar:

1. **Doğruluk**: hiç koşmamış bir job kapıyı geçemez. Dal koruması _atlanmış_ bir zorunlu
   kontrolü karşılanmış sayar; [#89](https://github.com/dravcore/kurul/pull/89) tam olarak
   böyle merge oldu (`test` kırmızı, `build` atlanmış). `ci-ok` `if: always()` ile koşar ve
   her `needs.*.result` değerinin tam olarak `success` olduğunu doğrular — `failure`, `skipped`
   ve `cancelled` üçü de kapıyı düşürür.
2. **Dal korumasıyla sabit bir sözleşme**: koruma artık her job adını değil tek bir bağlamı
   (`ci-ok`) tanıyor. Job eklemek, bölmek veya yeniden adlandırmak ayar değişikliği değil
   `ci.yml` düzenlemesi; hata yapılırsa sonuç CI'ın içinde kalır — workflow tanımadığı bir
   `needs` girdisiyle yüklenmeyi reddeder, hiçbir kontrol raporlanmaz ve PR kilitli kalır.
   Eskiden aynı hata, korumayı artık var olmayan bir bağlamı beklerken bırakıyordu.

CI, `develop` ve `main`'e yapılan push'larda olduğu gibi herhangi bir branch'a yapılan pull
request'lerde çalışır. Bkz.
[git-strategy.md](git-strategy.md#pull-request-süreci).

Workflow dosyası: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

### Imaj build'i ve CVE taraması

`image-scan`, projenin yayımladığı üç imajı (`kurul-api`'nin `runner` ve `migrate` hedefleri
ile `kurul-web`) build eder ve her birini Trivy'den geçirir. **Düzeltmesi mevcut olan** bir
HIGH ya da CRITICAL zafiyet o bacağı, dolayısıyla kapıyı düşürür. Bu job'dan önce bir
Dockerfile'ı build eden tek şey tag push'unda koşan `release-images.yml` idi; yani bozuk bir
imajı ya da zafiyetli bir base'i, işi onu yayımlamak olan workflow keşfediyordu.

Bilinmeye değer iki tercih:

- **Düzeltmesi olmayan zafiyetler yoksayılır** (`ignore-unfixed: true`). Hiçbir yerde
  düzeltilmiş sürümü olmayan bir base imaj CVE'si, hiçbir PR'ın yapabileceği bir şey olmadığı
  halde her PR'ı düşürürdü; sürekli kırmızı duran bir kontrolü de kimse okumaz. Geriye tam
  olarak aksiyon alınabilir küme kalır: bir base imaj yükseltmesi ya da bir bağımlılık
  yükseltmesi.
- **`build`'den sonra değil, `lint` ve `test`'in yanında koşar.** Job bilinçli olarak kritik
  yolun dışında; böylece pipeline duvar saatine değil runner dakikalarına mal olur ve aynı
  workflow'un `develop` koşularının yazdığı buildx katman cache'ini (`type=gha`) okur.

Hiçbir şey push edilmez: `push: false` ve `load: true` ile her imaj kendi runner'ının içinde
kalır. Yayımlama, tag'in arkasında, `release-images.yml`'de kalır.

### CI'da browser e2e

Browser suite'i kendi workflow'unda,
[`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml), farklı bir takvimle ve
**`ci-ok` kapısının dışında** koşar:

| Tetikleyici                      | Neden                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Her gece 03:00 UTC               | Günün merge'lerini içerecek kadar geç, kırmızı bir koşu sabah sizi beklesin diye yeterince erken     |
| `main`'e açılan pull request'ler | Onları yalnızca `release/*` ve `hotfix/*` açar, yani tam olarak sürüm adayı ve hotfix başına bir kez |
| `workflow_dispatch`              | İhtiyaç oldukça                                                                                      |

Zorunlu kontrol olmaması bilinçli. Bu suite Postgres, Redis, Mailpit, derlenmiş bir API ve
production web build'i başlatır, sonra Chromium'u hepsinin içinden geçirir — projenin en
değerli sinyali ve aynı zamanda hakkında yanılması en pahalı olanı. Zorunlu kapıya bağlansa,
tek bir altyapı aksaklığı depodaki her merge'i bloke ederdi. Hızlı ve zorunlu döngü `ci.yml`
olarak kalır; buradaki bir hata "dur" değil, "sürümden önce buna bak" demektir.

Suite'in tamamı `e2e/playwright.config.ts` içindeki `globalTimeout` ile **beş dakikayla**
sınırlıdır — temenni değil, zorlanan bir sınır, ve CI'da olduğu kadar yerelde de geçerli;
böylece bütçeyi ilk aşan koşu yazarın makinesindeki koşu olur. HTML raporu her koşuda,
trace'ler hata durumunda yüklenir; geceki bir hatayı ertesi sabah yeniden üretmeden teşhis
edilebilir kılan da budur.

## Ayrıca bakınız

- [development.md](development.md) — servisleri yerelde çalıştırma
- [coding-standards.md](coding-standards.md) — testlerin varsaydığı kod konvansiyonları
- [api-conventions.md](api-conventions.md) — assert edilecek status kodları ve hata şekilleri
- [git-strategy.md](git-strategy.md) — PR gereksinimleri
- [../../ROADMAP.md](../../ROADMAP.md) — MVP durumu ve Beyond MVP
