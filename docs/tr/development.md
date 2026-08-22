# Geliştirme

Kurul geliştirme ortamının nasıl kurulacağı ve günden güne nasıl çalışılacağı.

> 🌐 [English (canonical)](../development.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [Durum](#durum)
- [Ön koşullar](#ön-koşullar)
- [Klonlama ve kurulum](#klonlama-ve-kurulum)
- [Ortam değişkenleri](#ortam-değişkenleri)
- [Veritabanı ve cache kimlik bilgileri](#veritabanı-ve-cache-kimlik-bilgileri)
- [Veritabanı bağlantı havuzu](#veritabanı-bağlantı-havuzu)
- [SMTP ve Mailpit](#smtp-ve-mailpit)
- [Çalışma modları](#çalışma-modları)
- [Container sertleştirme](#container-sertleştirme)
- [pnpm script'leri](#pnpm-scriptleri)
- [Veritabanı iş akışı](#veritabanı-iş-akışı)
- [Veri saklama](#veri-saklama)
- [Aktivasyon hunisi ve telemetri](#aktivasyon-hunisi-ve-telemetri)
- [Yükseltme ve yedekleme](#yükseltme-ve-yedekleme)
- [Geri alma (rollback)](#geri-alma-rollback)
- [Gözlemlenebilirlik](#gözlemlenebilirlik)
- [Günlük döngü](#günlük-döngü)
- [Sorun giderme](#sorun-giderme)

## Durum

Monorepo ve MVP özellik seti (Faz 1–9; Faz 0 docs/standartlardı) repository’de **mevcuttur**. Bu sayfadaki komutlar
gündelik kontrattır — gerçeklik bu dokümandan sapıyorsa ikisinden biri buglıdır ve aynı
PR’da düzeltilir.

- Yerleşim ve modül haritası: [architecture.md](architecture.md#2-monorepo-yerleşimi)
- Veri modeli ve kritik alan kuralları: [architecture.md](architecture.md#kritik-alan-kuralları)
- Faz ilerlemesi (MVP tamam): [ROADMAP.md](../../ROADMAP.md)
- Her aracın neden seçildiği: [tech-stack.md](tech-stack.md)

## Ön koşullar

| Araç           | Sürüm              | Kontrol                  | Notlar                                                                                                                                                                                                           |
| -------------- | ------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js        | **≥ 24** (engines) | `node -v`                | Kök `package.json` `"engines": { "node": ">=24" }`. Prisma 7 ≥ 20.19.0 ister; proje tabanı daha yüksek. Desteklenen çizgi **24 LTS**.                                                                            |
| pnpm           | 9 veya üzeri       | `pnpm -v`                | Corepack üzerinden: `corepack enable && corepack prepare pnpm@latest --activate`. Corepack, Node ≥ 25 ile artık birlikte gelmiyor — orada önce `npm i -g corepack`, ya da pnpm'i bağımsız kurun: `npm i -g pnpm` |
| Docker         | herhangi güncel    | `docker -v`              | macOS'ta Docker Desktop veya Colima                                                                                                                                                                              |
| Docker Compose | v2 (plugin)        | `docker compose version` | `docker-compose` v1 desteklenmiyor                                                                                                                                                                               |
| Git            | 2.30+              | `git --version`          |                                                                                                                                                                                                                  |

Yerel bir PostgreSQL veya Redis kurulumu gerekmiyor — ikisi de Docker içinde çalışır.

## Klonlama ve kurulum

```bash
git clone https://github.com/dravcore/kurul.git
cd kurul
cp .env.example .env   # doldurun — aşağıdaki Ortam değişkenleri bölümüne bakın
pnpm install           # her workspace paketini kurar
pnpm bootstrap         # bu sayfadaki kurulum yolunun geri kalanı, tek komutta
```

Bu bölümün geri kalanı `pnpm bootstrap`'in ne yaptığını ve her adımın neden orada olduğunu
anlatıyor, çünkü o adımlar çalışırken zaten tek tek koşturacağınız adımlar — betiğin kendisi
için [Çalışma modları](#çalışma-modları) bölümüne bakın.

Repository bir pnpm workspace'idir (`apps/*`, `packages/*`). `pnpm install`'ı her zaman
repository kökünden çalıştırın — asla `apps/api` veya `apps/web` içinden değil.

Üretilen Prisma client'ı (`apps/api/src/generated/`) git-ignore'ludur ve onu oluşturan bir
`postinstall` hook'u yoktur — `pnpm db:generate` her temiz klonda gerekli ve açık bir adımdır.
`@prisma/client` türevli tipleri import eden kod, bunu en az bir kez çalıştırana kadar
typecheck'ten geçmez ve build olmaz.

`packages/shared-types` ve `packages/auth-access` build edilmiş `dist/` dizinlerinden tüketilir
ve o dizinler de aynı sebeple git-ignore'ludur; dolayısıyla temiz bir klonda `pnpm dev`,
`pnpm db:seed`, `nest build` veya `next build` koşmadan önce bunların build edilmesi gerekir:

```bash
pnpm -r --filter @kurul/shared-types --filter @kurul/auth-access build
```

Bu adımı atlamak yardımcı bir hata üretmez. `pnpm dev`, `apps/api` içinde `TS2307: Cannot
find module '@kurul/shared-types'` ile düşer; `pnpm db:seed` ise veritabanına hiç ulaşamadan
`Cannot find module '.../@kurul/auth-access/dist/cjs/index.js'` ile ölür; ikisi de eksik bir
build'den çok bozuk bir checkout gibi okunur. `pnpm build` ve `pnpm typecheck` bunu yan etki
olarak zaten yapar; `pnpm dev`, `pnpm db:seed` ve `pnpm lint` yapmaz. CI bunları lint
job'ından önce açıkça build eder, çünkü `pnpm typecheck` orada koşar.

Test suite'leri bunun istisnasıdır. Jest (`apps/api`, unit ve integration) ve Vitest
(`apps/web`, `packages/auth-access`) iki paketi de `src/index.ts` dosyalarına eşler; bu yüzden
`pnpm test` hiç `dist` olmayan bir checkout'ta geçer ve asla bayat bir build'e karşı koşmaz.
CI'daki test job'ı da bu sebeple build adımını bilerek atlar. Bayat build iki arızanın kötü
olanıdır, çünkü çözümlenir: son build'den sonra eklenen bir enum her tüketicide `undefined`
olarak okunur. `pnpm dev` ve `pnpm db:seed` hâlâ `dist` üzerinden gider; bu yüzden iki
paketten birine gelen bir değişikliği çektikten sonra yeniden build edin.

## Ortam değişkenleri

```bash
cp .env.example .env
```

Sonra boşlukları doldurun. `.env` git tarafından ignore edilir ve asla commit edilmemelidir.

| Değişken                              | Örnek                                                             | Amaç                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                        | `postgresql://kurul:<POSTGRES_PASSWORD>@localhost:5432/kurul`     | Prisma bağlantı string'i — şifre kısmı aşağıdaki `POSTGRES_PASSWORD` ile eşleşmelidir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `REDIS_URL`                           | `redis://localhost:6379`                                          | Socket.io Redis adapter'ı, caching, BullMQ zamanlanmış işler (`due-soon` ve `cleanup` kuyrukları). Veritabanı indeksi dikkate alınır — bkz. [Veritabanı ve cache kimlik bilgileri](#veritabanı-ve-cache-kimlik-bilgileri)                                                                                                                                                                                                                                                                                                                                                                         |
| `BETTER_AUTH_SECRET`                  | _(üret)_                                                          | Session imzalama secret'ı — zorunlu, varsayılan yok                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `BETTER_AUTH_URL`                     | `http://localhost:4000`                                           | API'nin public URL'i (Better Auth `/auth/*` altında monte edilir). Yalnızca geliştirme döngüsü — `docker-compose.yml` bunu `SITE_URL`'den türetir                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `API_PORT`                            | `4000`                                                            | NestJS dinleme portu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `WEB_URL`                             | `http://localhost:3000`                                           | API için CORS origin'i. Yalnızca geliştirme döngüsü — `docker-compose.yml` bunu `SITE_URL`'den türetir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SITE_URL`                            | `http://localhost`                                                | **Yalnızca compose.** Tüm stack'in yanıt verdiği tek public origin, şema dahil; `https://…` Caddy'nin otomatik HTTPS'ini açar. Bkz. [Self-hosting](self-hosting.md)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `INTERNAL_API_URL`                    | `http://api:4000`                                                 | **Web sunucusunun** middleware ve SSR için kullandığı mutlak API adresi (aynı origin'deki `/api`'nin Node içinde çözülecek bir origin'i yoktur). `docker-compose.yml` ayarlar; gömülmez, container başlangıcında okunur                                                                                                                                                                                                                                                                                                                                                                           |
| `API_DOCS_ENABLED`                    | _(`NODE_ENV`'i izler)_                                            | `/docs`'taki etkileşimli konsolu ve `/openapi.json`'daki OpenAPI belgesini yayınlar. Ayarlanmazsa `NODE_ENV`'i izler: development'ta açık, **production'da kapalı**. `/docs` kimlik doğrulaması olmayan bir HTML sayfası ve içindeki konsol okuyucunun kendi oturumuyla gerçek istek atıyor; bu yüzden bir production instance'ı bunu devre dışı bırakmak yerine bilerek açıyor. Aynı belge `apps/api/openapi.json`'da versiyon kontrolünde — bkz. [api-conventions.md](api-conventions.md#openapi-belgesi)                                                                                       |
| `RATE_LIMIT_ENABLED`                  | `true`                                                            | [Rate limiting](api-conventions.md#rate-limiting) ana anahtarı. Varsayılan açık; yalnızca entegrasyon testleri kapatır                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `TRUST_PROXY`                         | `false`                                                           | Gerçek client IP'si için güvenilecek reverse proxy hop'(lar)ı — `false` (varsayılan), hop sayısı (`1`) veya IP/CIDR listesi. Bkz. [rate limiting](api-conventions.md#rate-limiting) — doğrudan expose edilen bir kurulumda **asla `true` olmasın**                                                                                                                                                                                                                                                                                                                                                |
| `NEXT_PUBLIC_API_URL`                 | `http://localhost:4000`                                           | Web bundle'ına derlenen API URL'i — **build sırasında gömülür**. Yalnızca geliştirme döngüsü; Docker imajı bunun yerine aynı origin'deki `/api` yolunu gömer — tek imajın her domain'de çalışmasının nedeni budur                                                                                                                                                                                                                                                                                                                                                                                 |
| `REQUEST_BODY_MAX_BYTES`              | `1048576`                                                         | API'nin parse ettiği en büyük JSON veya form-encoded gövde, byte cinsinden (1 MiB). Aşılırsa cevap `413`'tür ve hata takibine **bildirilmez**. Bir multipart yüklemeyi hiç görmez — bkz. [api-conventions.md](api-conventions.md#request-body-boyutu)                                                                                                                                                                                                                                                                                                                                             |
| `STORAGE_PATH`                        | _(geliştirme döngüsünde boş)_                                     | Yüklenen ek dosyalarını tutan dizin. **Boş olması ek'lerin kapalı olması demektir**: `GET /config` `attachmentsEnabled: false` döner ve UI yükleme kontrolünü gizler. Bağlantılar her hâlükârda çalışır. `docker-compose.yml` bunu `attachment_data` volume'ünün içine kendisi ayarlar                                                                                                                                                                                                                                                                                                            |
| `ATTACHMENT_MAX_BYTES`                | `26214400`                                                        | Tek bir ek **dosyasının** en büyük boyutu, byte cinsinden (25 MiB). Hem disk hem bellek tavanı — tip sniff edilebilsin diye yükleme tamponlanır. Ters proxy'nin gövde limitinin altında kalmalı; sıralama kuralı [self-hosting.md](self-hosting.md#kendi-reverse-proxynizi-kullanmak) içinde                                                                                                                                                                                                                                                                                                      |
| `ATTACHMENT_WORKSPACE_QUOTA_BYTES`    | `2147483648`                                                      | Bir workspace'in saklanan dosyalarının **toplam** boyutuna tavan, byte cinsinden. Ayarlanmamış ya da boş = bu varsayılan (2 GiB); yazılı bir `0` tavanı kaldırır; negatif değer açılışı reddeder. Yüklemede workspace'in FILE eklerinin `SUM(size)` toplamına karşı denetlenir; bağlantılar byte saklamaz ve hiç sayılmaz. Kota **yumuşaktır** — eşzamanlı yüklemeler en fazla birer dosya aşabilir. Ret, `error: "Attachment Quota Exceeded"` taşıyan `413`'tür ([ADR 0027](decisions/0027-attachment-quotas.md), 2026-08-21'de güncellendi)                                                     |
| `ATTACHMENT_INSTANCE_QUOTA_BYTES`     | `21474836480`                                                     | Aynı tavan, instance'taki **bütün** workspace'ler üzerinden toplanmış hali; ayarlanmamış = 20 GiB, `0` = sınırsız. Volume'ün gerçek boş alanının altına ayarlayın: dağıtılan Compose yığınındaki `STORAGE_PATH`, dosya sistemini Postgres'le paylaşır. API iki kotanın da geçerli değerini açılışta, hangisinin ortamdan geldiğini belirterek loglar ve bu değer workspace kotasının altına ayarlanmışsa uyarır ([ADR 0027](decisions/0027-attachment-quotas.md))                                                                                                                                 |
| `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`  | `268435456`                                                       | Bir istemci IP'sinin sabit bir dakikada yükleme rotasına gönderebileceği byte (256 MiB, yaklaşık on tam boy yükleme); her isteğin `Content-Length`'i multer gövdeyi okumadan önce düşülür, `Content-Length` taşımayan multipart istek `ATTACHMENT_MAX_BYTES` kadar düşülür. `0` kapatır; negatif değer açılışı reddeder. `RATE_LIMIT_ENABLED` ve `TRUST_PROXY`'ye uyar; sayaçlar `REDIS_URL` ayarlıyken Redis'te yaşar, Redis hatasında süreç belleğine düşer. Ret, `error: "Upload Budget Exceeded"` ve `Retry-After` taşıyan `429`'dur ([api-conventions.md](api-conventions.md#rate-limiting)) |
| `TRELLO_IMPORT_MAX_BYTES`             | `20971520`                                                        | Importer'ın kabul ettiği en büyük Trello export'u, byte cinsinden (20 MiB). Disk değil **heap** tavanı — parse edilmiş grafik, onu üreten byte'ların birkaç katıdır. Yukarıdaki iki limitten de ayrı, ve import `STORAGE_PATH` istemez ([ADR 0025](decisions/0025-trello-import-mapping.md))                                                                                                                                                                                                                                                                                                      |
| `SMTP_HOST`                           | `localhost` (geliştirme, Mailpit üzerinden)                       | SMTP sunucu host'u. Tamamen boş bırakılırsa mail modülü göndermek yerine loglar — bkz. [SMTP ve Mailpit](#smtp-ve-mailpit)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `SMTP_PORT`                           | `1025` (geliştirme, Mailpit üzerinden) / `587` (tipik production) | SMTP sunucu portu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SMTP_USER`                           | _(Mailpit için boş)_                                              | SMTP auth kullanıcı adı, sunucunuz gerektiriyorsa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SMTP_PASSWORD`                       | _(Mailpit için boş)_                                              | SMTP auth şifresi, sunucunuz gerektiriyorsa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SMTP_SECURE`                         | `false`                                                           | Örtük TLS için (port 465) `true`, STARTTLS/plaintext için (587/25, ve Mailpit) `false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `MAIL_FROM`                           | `Kurul <noreply@example.com>`                                     | Giden mail'lerdeki `From:` başlığı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `CLEANUP_ENABLED`                     | `true`                                                            | Gecelik [veri saklama süpürmesi](#veri-saklama) ana anahtarı. Kapalıysa instance kendi saklama politikasını uygulamayı bırakır                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `NOTIFICATION_RETENTION_DAYS`         | `90`                                                              | Bir bildirimin **okunduktan sonra** saklandığı gün sayısı. Okunmamış bildirimler hangi yaşta olursa olsun silinmez. `0` = sonsuza dek                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ACTIVITY_RETENTION_DAYS`             | `365`                                                             | Bir aktivite satırının yazıldıktan sonra saklandığı gün sayısı. `0` = sonsuza dek — yasal denetim izi yükümlülüğünüz varsa bunu kullanın                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `INVITATION_RETENTION_DAYS`           | `90`                                                              | **Sonuçlanmış** bir davetin, oluşturulduğu andan itibaren saklandığı gün sayısı. Sonuçlanmış = yanıtlanmış (accepted/rejected/canceled) ya da süresi dolmuş; süresi dolmamış `pending` bir davet hangi yaşta olursa olsun silinmez. `0` = sonsuza dek                                                                                                                                                                                                                                                                                                                                             |
| `DATABASE_POOL_MAX`                   | `20`                                                              | Paylaşılan `pg` havuzunun Postgres'e açtığı azami eşzamanlı bağlantı sayısı — bkz. [Veritabanı bağlantı havuzu](#veritabanı-bağlantı-havuzu)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `10000`                                                           | Tüm `DATABASE_POOL_MAX` bağlantılar meşgulken bir isteğin havuzdan bağlantı için ne kadar bekleyeceği — bkz. [Veritabanı bağlantı havuzu](#veritabanı-bağlantı-havuzu)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `DATABASE_STATEMENT_TIMEOUT_MS`       | `30000`                                                           | Postgres'in tek bir SQL ifadesini öldürmeden önce ne kadar çalışmasına izin vereceği — bkz. [Veritabanı bağlantı havuzu](#veritabanı-bağlantı-havuzu)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SENTRY_DSN`                          | _(boş)_                                                           | API hata takibi. **Boş = kapalı, ve kapalı SDK'nın hiç yüklenmemesi demektir** — bkz. [Gözlemlenebilirlik](#gözlemlenebilirlik)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SENTRY_ENVIRONMENT`                  | _(boş)_ / `production`                                            | API event'lerindeki ortam etiketi; boşsa `NODE_ENV`'e düşer. Staging ve production aynı imajı çalıştırıyorsa açıkça ayarlayın                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `SENTRY_RELEASE`                      | _(boş)_ / `v0.2.0`                                                | API event'lerindeki sürüm etiketi; en iyisi dağıtılan tag. Boşsa hiç gönderilmez                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `NEXT_PUBLIC_SENTRY_DSN`              | _(boş)_                                                           | Web hata takibi, aynı opt-in kuralı — **build sırasında gömülür**, değiştirdikten sonra web imajını yeniden build edin                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT`      | _(boş)_ / `production`                                            | `SENTRY_ENVIRONMENT`'ın web karşılığı, o da build zamanlı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `NEXT_PUBLIC_SENTRY_RELEASE`          | _(boş)_ / `v0.2.0`                                                | `SENTRY_RELEASE`'in web karşılığı, o da build zamanlı                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SEED_LARGE_BOARD_TASKS`              | _(boş)_ / `1000`                                                  | Yalnızca `pnpm db:seed` okur. Demo board'un yanına bu kadar task taşıyan sentetik bir board ekler. Boş ya da `0` atlar — bkz. [Büyük board seed'lemek](#büyük-board-seedlemek)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `INSTANCE_ADMIN_EMAILS`               | _(boş)_                                                           | Kurulum genelindeki [aktivasyon hunisini](#aktivasyon-hunisi-ve-telemetri) okumasına izin verilen, virgülle ayrılmış adresler. **Boş, hiç kimse demektir** — makinedeki her workspace'in sahibi olan hesap dahil. Listelenen bir adres, yalnızca o hesabın e-postası doğrulanmışsa erişim kazanır                                                                                                                                                                                                                                                                                                 |
| `TELEMETRY_ENABLED`                   | `false`                                                           | Dışa telemetri. **Varsayılan kapalı; bu `false` iken hiçbir şey gönderilmez** — bkz. [Aktivasyon hunisi ve telemetri](#aktivasyon-hunisi-ve-telemetri)                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `TELEMETRY_ENDPOINT`                  | _(boş)_                                                           | Opt-in ping'in POST edileceği adres. **Varsayılanı yok**; `TELEMETRY_ENABLED=true` iken bu boşsa hata loglanır ve hiçbir şey gönderilmez                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `TELEMETRY_TIMEOUT_MS`                | `5000`                                                            | Açılıştaki tek ping'in terk edilmeden önce sürebileceği süre. Başarısızlık tek bir uyarı satırıdır, başka hiçbir şey değil                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

`SENTRY_AUTH_TOKEN`, `SENTRY_ORG` ve `SENTRY_PROJECT` yalnızca `next build` tarafından, source
map yüklenirken ve yalnızca ayarlanmışlarsa okunur; bunlar olmadan build sessizce başarılı
olduğu için `.env.example`'da yer almazlar. Bkz.
[Gözlemlenebilirlik](#gözlemlenebilirlik).

`.env.example` ayrıca `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `REDIS_PASSWORD`,
`BACKUP_INTERVAL` ve `BACKUP_KEEP` taşır. Altısı da **yalnızca compose'a aittir** —
`docker-compose.yml` bunları `postgres`/`redis`/`migrate`/`api`/`backup` servislerine
enterpolasyon eder ve hiçbir uygulama kodu doğrudan okumaz; bu yüzden yukarıdaki tabloda yer
almazlar ve `apps/api` tarafında bağlanmaları gerekmez. İlk dördü için bkz.
[Veritabanı ve cache kimlik bilgileri](#veritabanı-ve-cache-kimlik-bilgileri), yedekleme
çifti için bkz. [Yükseltme ve yedekleme](#yükseltme-ve-yedekleme).

Bir secret üretmek için:

```bash
openssl rand -base64 32
```

**Yeni bir ortam değişkeni eklemek üç adımlı bir değişikliktir** ve üçü de aynı PR'a girer:
`apps/api/src/common/env.ts` yardımcıları üzerinden bağla (veya `process.env` okuyan çağrı
noktası — bugün ayrı bir Zod/tipli env şeması yok), güvenli bir placeholder ile
`.env.example`'a ekle ve yukarıdaki tabloda belgele.

## Veritabanı ve cache kimlik bilgileri

Ne `docker-compose.yml` ne de `docker-compose.dev.yml` artık Postgres konteynerine bilinen bir
`kurul`/`kurul` şifresi gömüyor — `POSTGRES_PASSWORD` zorunlu bir `.env` değeridir ve
ayarlanmadan compose başlamayı reddeder:

```bash
$ docker compose config
error while interpolating services.migrate.environment.DATABASE_URL: required variable POSTGRES_PASSWORD is missing a value: set POSTGRES_PASSWORD in .env — see docs/development.md#database-and-cache-credentials
```

Bu, yukarıdaki `BETTER_AUTH_SECRET` ile aynı fail-loud kalıbıdır: bir placeholder varsayılan,
`.env.example`'ı dikkatlice okumayan her self-hosted kurulumun, Docker ağını paylaşan başka
her şeye açık bir veritabanında, diğer her Kurul kurulumuyla aynı şifreyle ayağa kalkması
anlamına gelirdi.

**`POSTGRES_PASSWORD` ve `REDIS_PASSWORD`'ü, yukarıdaki `BETTER_AUTH_SECRET` için kullanılan
`-base64 32` yerine `openssl rand -hex 32` ile üretin.** Fark burada
`BETTER_AUTH_SECRET`'teki gibi önemsiz değil: bu iki değer doğrudan bir bağlantı URL'ine
gömülür (`DATABASE_URL`/`REDIS_URL`) ve percent-encode etmiyoruz, dolayısıyla `/ @ : # ? %`
karakterlerinden biri değere düşerse URL bozulur — en keskin durum `/`'dir, çünkü göründüğü
yerde authority bölümünü doğrudan sonlandırır:

```bash
$ node -e "new URL('postgresql://kurul:ab/cd@postgres:5432/kurul')"
TypeError: Invalid URL
    at new URL (node:internal/url:840:25)
  code: 'ERR_INVALID_URL'

$ openssl rand -hex 32
1b7c3785ecf7f7bd2ec4826214889d19ff17d518ce44126ab6f07393b39b98a   # yalnızca 0-9a-f, her zaman URL-güvenli
```

`-base64 32`'nin alfabesi `/` ve `+` içerir; parola başına 43 base64 karakteriyle, en az bir
`/` veya `+`'nin düşme olasılığı `1 - (63/64)^43 ≈ %51` — yeni üretilen bir parolanın kendi
bağlantı string'ini sessizce bozup bozmayacağı kabaca yazı tura. `openssl rand -hex 32`'de
kaçınılması gereken böyle bir karakter yok.

| Değişken            | Varsayılan      | Amaç                                                                                                                   |
| ------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`     | `kurul`         | Compose'un ilk açılışta oluşturduğu ve her servisin bağlandığı Postgres rolü                                           |
| `POSTGRES_PASSWORD` | _yok — zorunlu_ | Postgres rol şifresi. Varsayılanı yok; ayarlanmazsa `docker compose config`/`up` sesli şekilde başarısız olur          |
| `POSTGRES_DB`       | `kurul`         | Compose'un ilk açılışta oluşturduğu veritabanı adı                                                                     |
| `REDIS_PASSWORD`    | _(boş)_         | `redis` servisi için opsiyonel `requirepass`. Boş bırakılırsa Redis bu değişken var olmadan önceki gibi şifresiz kalır |

Bu dört değişken, `docker-compose.yml`'in kendi `migrate`/`api` servisleri için kurduğu
`DATABASE_URL`/`REDIS_URL`'i besler (`postgres:5432`/`redis:6379`, ağ içi adresler) — bu,
[dev loop](#çalışma-modları)'da `pnpm dev`'in `localhost:5432`/`localhost:6379`'a ulaşmak için
kullandığı `.env`'inizdeki host-side `DATABASE_URL`/`REDIS_URL`'den **ayrı** bir düğmedir.
Compose ikisini birbiriyle senkron tutmaz: `POSTGRES_PASSWORD` veya `REDIS_PASSWORD`'ü
değiştirirseniz, host-side `DATABASE_URL`/`REDIS_URL`'i de eşleştirin — yoksa host'ta çalışan
`api`/`web`, `docker-compose.dev.yml`'in başlattığı konteynerlere karşı authenticate olamaz.

`REDIS_PASSWORD`, `POSTGRES_PASSWORD`'ün sahip olduğu `:?`-zorunlu koruması olmadan
tasarlanmıştır — buradaki Redis cache girdileri, session'lar, rate-limit sayaçları ve
bildirim kuyruğunu tutar; hepsi yeniden inşa edilebilir, hiçbiri board verisi değildir (bkz.
["Redis yedeklenmez"](#yükseltme-ve-yedekleme)) — bu yüzden zorunlu kılmak, karşılığında
görece az bir kazanç için her mevcut `docker-compose.yml`'i yükseltmede bozardı. Boş
bırakmak önceki şifresiz davranışı korur; ayarlamak, aynı Docker ağına düşen başka bir
konteynere karşı savunma derinliği ekler.

**Bir `REDIS_URL` veritabanı indeksi taşıyabilir ve bu indeks dikkate alınır.**
`redis://localhost:6379/3`, bu instance'ın anahtarlarını — auth rate-limit sayaçları ve her iki
BullMQ kuyruğu — 3 numaralı indekse koyar; birkaç uygulamanın tek bir Redis'i birbirinin
keyspace'ine basmadan paylaşma yolu budur.
[#190](https://github.com/dravcore/kurul/issues/190) öncesinde indeks ayrıştırılıp atılıyordu:
böyle bir URL kabul ediliyor ama yine de 0 numaralı veritabanı kullanılıyordu; o düzeltmeden
önce bir indeks belirlediyseniz ve 0 numaralı veritabanındaki bir şey başka bir uygulamaya
aitmiş gibi görünüyorsa, muhtemelen öyleydi. Bilinmesi gereken iki sınır var. **Pub/sub
veritabanına göre ayrılmaz:** Redis, yayımlanan bir mesajı, her bağlantının hangi indeksi
seçtiğinden bağımsız olarak o kanalın tüm abonelerine iletir; dolayısıyla farklı indekslerdeki
iki Kurul instance'ı Socket.io fan-out kanalını yine paylaşır — indeks keyspace'leri ayırır,
kanalları değil. Bir de: indeks negatif olmayan düz bir tam sayı değilse
(`redis://host:6379/staging`) ya da path ile `?db=` birbiriyle çelişiyorsa
(`redis://host:6379/3?db=4`), sessizce 0 diye okunmak yerine bağlantı anında reddedilir — bu
ayarın tüm amacı iki uygulamayı ayrı tutmak olduğuna göre, içindeki bir yazım hatası onları bir
araya getirmemelidir.

**`POSTGRES_PASSWORD`'ü mevcut bir `postgres_data` volume'unda değiştirmek, çalışan
veritabanının şifresini döndürmez.** Resmi Postgres image'ı `POSTGRES_PASSWORD`'ü yalnızca
`initdb` sırasında, yani bir volume ilk oluşturulduğunda uygular — `.env`'i düzenleyip zaten
initialize edilmiş bir stack'i yeniden başlatmak, rolün şifresini tam olarak eskisi gibi
bırakır. Çalışan bir instance'ta şifreyi döndüren `ALTER USER ... PASSWORD` komutu için
`CHANGELOG.md`'deki `[Unreleased]` girdisine bakın.

### Checkout'unuz yeniden adlandırmadan eskiyse

Postgres rolü ve veritabanı artık `kurul`; v0.2.0 öncesinde `kurultay`'dı. Elinde zaten bir
`.env` ve çalışan bir dev stack olan bir working tree eskisini korur ve bir şey bozulana kadar
bunu size kimse söylemez — o yüzden tek seferde, bilinçli olarak yapmaya değer:

```bash
# 1. .env'i yeni kimliklere çevirin (DATABASE_URL, POSTGRES_USER, POSTGRES_DB).
# 2. Rolü ve iki veritabanını, elinizdeki volume üzerinde yaratın:
docker compose -f docker-compose.dev.yml exec -T postgres psql -U kurultay -d kurultay \
  -c "CREATE ROLE kurul LOGIN SUPERUSER PASSWORD 'kurul';" \
  -c 'CREATE DATABASE kurul OWNER kurul;' \
  -c 'CREATE DATABASE kurul_test OWNER kurul;'

# 3. İkisini de migrate edin. Test veritabanı ayrı bir veritabanıdır, kendi koşusunu ister:
pnpm db:migrate
DATABASE_URL=postgresql://kurul:kurul@localhost:5432/kurul_test pnpm db:migrate
```

İki hatayı hata ayıklamak yerine tanımak daha iyi. Entegrasyon suite'inden gelen
`The table public.UsagePing does not exist`, 3. adımın yalnız dev veritabanında koşturulduğu
anlamına gelir. `DATABASE_URL does not name a test database` ise yeniden adlandırmayla hiç
ilgili değildir — `setup-e2e.ts`'in, adında `kurul_test` geçmeyen bir veritabanını truncate
etmeyi reddetmesidir; yani koruma çalışıyordur. O komut için `DATABASE_URL`'i test
veritabanına yöneltin ya da tamamen boş bırakın.

Eski `kurultay` rolünü ve veritabanlarını düşürmek isteğe bağlıdır; yerelde hiçbir şeyin
onlara bakmadığından emin olana kadar bekleyebilir.

## Veritabanı bağlantı havuzu

`apps/api/src/prisma/database.ts` process genelinde tek bir `pg` `Pool` açar ve bunu
`PrismaService` ile Better Auth (`apps/api/src/auth/auth.ts`) arasında paylaştırır — neden ayrı
ayrı değil de paylaşmaları gerektiği için modülün kendisine bakın. Üç ortam değişkeni bunu
şekillendirir; üçü de opsiyoneldir ve varsayılanları normal trafiğin asla tetiklemeyeceği kadar
cömert seçilmiştir:

| Değişken                              | Varsayılan | Amaç                                                                                   |
| ------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `DATABASE_POOL_MAX`                   | `20`       | Bu instance'ın Postgres'e açtığı azami eşzamanlı bağlantı sayısı                       |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | `10000`    | Tüm `DATABASE_POOL_MAX` bağlantılar meşgulken bir isteğin bağlantı için beklediği süre |
| `DATABASE_STATEMENT_TIMEOUT_MS`       | `30000`    | Postgres'in tek bir SQL ifadesini öldürmeden önce ne kadar çalışmasına izin verdiği    |

`DATABASE_POOL_CONNECTION_TIMEOUT_MS` var olmadan önce, havuz zaten `DATABASE_POOL_MAX`
bağlantıda dolu haldeyken gelen bir istek sınırsız kuyrukta bekliyordu — `pg`'nin kendi
varsayılanı burada `0`'dır, yani sonsuza dek bekle. Sürekli yük altında bu, havuz doygunluğunu
net, loglanmış bir hata yerine hiç sonuçlanmayan isteklere dönüştürüyordu.
`DATABASE_STATEMENT_TIMEOUT_MS` sorgu tarafındaki eşdeğer boşluğu kapatır: bu olmadan, kaçak
bir ifade (eksik bir index'e çarpan büyük bir tarama, patolojik bir filtre) bir bağlantıyı — ve
`DATABASE_POOL_MAX` slotlarından birini — süresiz tutar.

`DATABASE_STATEMENT_TIMEOUT_MS`, bu havuzun açtığı **her bağlantıya**, bir Postgres başlangıç
parametresi olarak uygulanır (`pg`'nin kendi handshake'i, bu kod tabanının gönderdiği bir sorgu
değil) — dolayısıyla yalnızca `getSharedPool()` üzerinden geçen trafiğe ulaşır:

- `prisma migrate deploy` / `prisma migrate dev` etkilenmez — migration'lar Prisma'nın kendi
  engine sürecinden, `DATABASE_URL`'e doğrudan bağlanarak çalışır, bu havuz üzerinden asla.
- `pnpm db:seed` (`apps/api/prisma/seed.ts`) kendi toplu silme/ekleme işlemleri için
  etkilenmez — bunlar için ayrı bir `Pool` açar. Seed'in paylaşılan havuzu geçen tek kısmı,
  Better Auth çağrılarıdır (`signUpEmail`, `createOrganization`); bunlar da 30 saniyelik
  varsayılana hiç yaklaşmayan sıradan, hafif sorgulardır.

Bir instance spike'lar dışında normal yük altında da sürekli kuyruğa giriyorsa,
`DATABASE_POOL_MAX`'ı Postgres'in kendi `max_connections`'ıyla birlikte artırın; sınırsız bir
havuz bunu düzeltmez, sadece tükenmeyi bu uygulamadan veritabanını paylaşan başka bir şeye
taşır.

## SMTP ve Mailpit

Kurul iki şey için e-posta gönderiyor: `accept-invitation`'ın bir davet edilenin
workspace'e katılmasına izin vermeden önce ihtiyaç duyduğu doğrulama linki (bkz.
[`decisions/0013-invitation-email-verification.md`](decisions/0013-invitation-email-verification.md))
ve her kullanıcının Ayarlar'dan kapatabildiği bildirim e-postaları (atama, mention, due-soon).
`SMTP_HOST`'u boş bırakmak geçerli bir seçenek — API yine ayağa kalkar ve mail modülü mesajı
göndermek yerine loglar — ama bu doğru olduğu sürece **hiçbir davet kabul edilemez** ve hiçbir
bildirim e-postası çıkmaz.

Bu durum yalnızca burada değil, üründe de görünür. `GET /config`
`{ "mailEnabled": false }` döner ve web uygulaması bunu **Ayarlar → Üyeler** ekranında,
davetlerin teslim edilmeyeceğini söyleyen ve bu bölüme link veren kalıcı bir uyarıya çevirir.
`POST /workspaces/:workspaceId/invitations` ayrıca az önce oluşturduğu davet için
`"emailDelivery": "NOT_CONFIGURED"` bildirir; böylece admin bunu, hiçbir e-posta almamış bir
takım arkadaşından değil, daveti gönderdiği anda öğrenir. İkisi de mail modülünün gerçekten
seçtiği transport'tan türer — bkz.
[api-conventions.md](api-conventions.md#instance-yapılandırması). SMTP'siz geçiş yolu her
bekleyen davetin üzerindeki **Bağlantıyı kopyala** kontrolüdür: davet edilenin adresi zaten
doğrulanmışsa kabul bağlantısı çalışır.

Gerçek mail göndermeden akışı lokal olarak yerinde denemek için, `docker-compose.dev.yml`'in
`postgres` ve `redis`'in yanında zaten başlattığı `mailpit` servisini kullanın:

```bash
docker compose -f docker-compose.dev.yml up -d   # postgres + redis + mailpit
```

Sonra `.env`'inizde şunları set edin (zaten `.env.example`'ın önerdiği varsayılanlar, ama
Mailpit host/port'un ona açıkça yönlendirilmesini gerektirir):

```bash
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
# SMTP_USER / SMTP_PASSWORD boş kalır — Mailpit auth gerektirmez
MAIL_FROM=Kurul <noreply@example.com>
```

| URL                   | Ne                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------- |
| http://localhost:8025 | Mailpit web UI'ı — API'nin gönderdiği her mesaj gerçek bir inbox yerine buraya düşer  |
| localhost:1025        | Mailpit'in SMTP dinleyicisi — yukarıdaki `SMTP_HOST`/`SMTP_PORT`'un işaret ettiği yer |

Davet akışını uçtan uca test etmek için: uygulamadan bir davet gönderin, http://localhost:8025
adresini açın, en yeni mesaja tıklayın ve içindeki doğrulama linkini tarayıcınızda açın (veya
kopyalayın — Mailpit hem plain-text hem HTML kısımları render eder, link her ikisinde de aynı
şekilde çalışır). Davet edilenin hesabı artık doğrulanmıştır ve `accept-invitation` başarılı
olur. `docker compose -f docker-compose.dev.yml down -v`, Postgres/Redis volume'leriyle
birlikte Mailpit'in sakladığı mesajları da temizler — yalnızca geliştirme döngüsünün kendi
`kurul-dev_*` volume'leri, tam stack'inkiler asla değil; bkz. aşağıdaki
[Docker'da tam stack](#dockerda-tam-stack).

## Çalışma modları

### Önerilen: geliştirme döngüsü (servisler Docker'da, uygulamalar host'ta)

Postgres ve Redis container'larda çalışır; `api` ve `web` host'ta hot reload ile çalışır. Bu
hızlı döngü — kod değişiklikleri arasında image rebuild gerekmez.

```bash
pnpm bootstrap   # paylaşılan paketler, Prisma client, container'lar, migration'lar, demo veri
pnpm dev         # api + web paralel, hot reload
```

`pnpm bootstrap` ([`scripts/bootstrap.mjs`](../../scripts/bootstrap.mjs)) tam olarak aşağıdaki
komutları, bu sırayla koşturur; üstüne `.env` üzerinde bir ön kontrol ve container'ların kendi
healthcheck'lerine bir bekleme ekler — TCP bağlantısını kabul etmiş ama `initdb`'yi bitirmemiş
bir Postgres'e atılan `prisma migrate` tam olarak o beklemenin engellediği hatadır ve ilk
koşuşta karşılaşılan hata odur. Yalnız birini istediğinizde elle koşturun:

```bash
pnpm -r --filter @kurul/shared-types --filter @kurul/auth-access build
pnpm db:generate                                 # Prisma client'ı üret
docker compose -f docker-compose.dev.yml up -d   # postgres + redis + mailpit
pnpm db:migrate                                  # migration'ları uygula
pnpm db:seed                                     # demo workspace, board, column, task
```

Betik idempotent'tir ve `git pull` sonrası yeniden koşturulmak üzere tasarlanmıştır; doğrudan
`pnpm db:seed` çağırmamasının sebebi de budur: seed **insert'ten önce siler**, dolayısıyla
yalnız veritabanında hiç `Workspace` satırı yokken çalışır. `--seed` yine de zorlar, `--no-seed`
atlar. Betik o tabloyu herhangi bir sebeple okuyamazsa da atlar — yıkıcı dal asla tahmine
dayanarak seçilmez.

`schema.prisma`'nın ve commit edilmiş migration'ların hâlâ uyuştuğunu doğrulamak için, en son
migration'a alınmış bir veritabanına karşı `pnpm db:drift` çalıştırın — aşağıdaki [Migration
sapmasını kontrol etme](#migration-sapmasını-kontrol-etme) bölümüne bakın.

| URL                          | Ne                            |
| ---------------------------- | ----------------------------- |
| http://localhost:3000        | Web uygulaması (Next.js)      |
| http://localhost:4000        | API (NestJS)                  |
| http://localhost:4000/health | Health check — 200 dönmelidir |

Container'ları `docker compose -f docker-compose.dev.yml down` ile durdurun (geliştirme
döngüsünün kendi `postgres_data`/`redis_data`'sını da düşürüp temiz bir sayfadan başlamak için
`-v` ekleyin).

### Docker'da tam stack

Her şey container'da, production'a en yakın hâl. Dockerfile'ları ve compose bağlantısını
doğrulamak için, veya Kurul'u geliştirmek değil sadece çalıştırmak istediğinizde kullanın.

```bash
docker compose pull && docker compose up -d
```

Bu, kendi Compose project'inde çalışır — genelde `kurul` olan checkout dizininin adı,
çünkü `docker-compose.yml` kendi `name:`'ini bildirmiyor — ve yukarıdaki geliştirme
döngüsünün `kurul-dev` project'inden tamamen ayrıdır (`docker-compose.dev.yml`,
`name: kurul-dev` bildirir). Her container ve volume kendi project'i tarafından
namespace'lendiği için ikisi asla çakışmaz: tam stack'i ayağa kaldırmak geliştirme
döngüsünün `postgres`/`redis`/`mailpit`'ini ne yeniden oluşturur ne de dokunur, ve
`docker compose -f docker-compose.dev.yml down -v` da tam stack'in volume'lerine dokunmaz —
ikisini aynı makinede aynı anda çalıştırsanız bile. (OPS-04, 2026-08-18 audit — bu ayrımdan
önce iki dosya da aynı dizin-türevli project adına düşüyordu, dolayısıyla container ve volume
adlarını paylaşıyor, birbirlerinin verisini yeniden oluşturabiliyor veya silebiliyordu.)

Ardından **http://localhost** adresini açın — `localhost:3000` değil. Stack'in tek yayınlanmış
girişi bir `proxy` (Caddy) servisidir: web uygulamasını ve API'yi tek origin'den sunar, `/api/*`
ile `/auth/*`'ı `api`'ye, geri kalan her şeyi `web`'e yönlendirir. `api` ve `web` kendi host
portlarını yayınlamaz. Tamamını bir domain'e taşımak için `.env`'de
`SITE_URL=https://kurul.example.com` ayarlayın; bu aynı zamanda otomatik HTTPS'i de açar —
SMTP ve yedekler dahil adım adım rehber: [Self-hosting](self-hosting.md).

`docker-compose.yml`'de `api`, `web` ve `migrate`, üçü de hem `image:` hem `build:` bildirir.
Her etiketli release üçünü de GHCR'a yayınlar (`.github/workflows/release-images.yml`,
`linux/amd64` + `linux/arm64`), böylece `pull` hazır build edilmiş imajı çeker, ardından gelen
`up -d` de onu başlatır — lokal build yok, `pnpm install` yok, Docker layer cache ısıtması yok.
Belirli bir release'i `latest` yerine sabitlemek için `.env`'de `TAG` ayarlayın:

```bash
TAG=v0.2.0   # release-images.yml'in yayınladığı bir tag ile eşleşmeli; liste için `git tag -l`
```

Compose'un varsayılan pull politikası bir servisi yalnızca `image:` tag'i lokalde veya
registry'de çözülemediğinde build eder, dolayısıyla `pull` adımını atlarsanız da hiçbir şey
bozulmaz: `docker compose up -d` tek başına da önce registry'yi dener ve `TAG`'iniz için henüz
yayınlanmış bir imaj yoksa (release öncesi, veya hiç yayınlanmamış bir `TAG`) ya da
`ghcr.io`'ya ağ erişimi yoksa otomatik olarak `build:`'e döner — bu repo'nun her zaman yaptığı
aynı kaynak build'i. `docker compose up --build` (veya `up -d --build`) bilinçli olarak build
etmek için (örn. bir Dockerfile'ı düzenledikten sonra veya `api`/`web`'de yayınlanmamış bir
değişikliği test ederken) değişmeden çalışmaya devam eder.

`migrate` eskiden tek istisnaydı: `image:` eşleniği yoktu, dolayısıyla her zaman kaynaktan
build ediyordu — [denetim bulgusu OPS-04](https://github.com/dravcore/kurul/issues/126)'ün
bilinçli seçtiği, ama build edilecek bir kaynak ağacı hiç indirmeyen
[docs/self-hosting.md](self-hosting.md)'deki curl tabanlı kurulumu tamamen kırdığı ortaya
çıkan bir kapsamdı (denetim bulgusu OPS-01). Artık `api`/`web` ile aynı `image:` + `build:`
çiftini taşıyor ve `ghcr.io/dravcore/kurul-migrate`, v0.2.0'dan sonraki ilk sürümden itibaren
yayınlanıyor — `TAG=v0.2.0` veya daha eskisinde çekilecek böyle bir imaj yoktur ve servis
tam eskisi gibi kaynaktan build eder.

### İki API imajı ne kadar yer kaplıyor

`linux/arm64` üzerinde ölçüldü. Docker "bu imaj ne kadar" sorusuna birbirinden hayli uzak üç
yanıt veriyor; üçü de burada — `docker history` toplamı, `docker image ls --tree`'nin DISK
USAGE'ı (host üzerinde açılmış bayt) ve CONTENT SIZE'ı (sıkıştırılmış, kabaca bir `pull`'un
taşıdığı miktar):

| İmaj             | `docker history` | Diskte açılmış   | Sıkıştırılmış |
| ---------------- | ---------------- | ---------------- | ------------- |
| `api` (`runner`) | 955 → 407 MB     | 1.22 GB → 516 MB | 266 → 108 MB  |
| `migrate`        | 2663 → 418 MB    | 3.37 GB → 538 MB | 705 → 120 MB  |

Hiçbiri uygulamanın bağımlılıklarını değiştirerek küçülmedi. `runner` imajı, `pnpm deploy
--prod`'un deploy dizininde bıraktığı isteğe bağlı peer bağımlılıklarından kurtuldu — Next.js'in
SWC binary'leri, Prisma CLI ve Studio, sharp, Playwright, TypeScript derleyicisi; hiçbirine
`dist/main.js` üzerinden erişilemiyor — bunları artık `scripts/prune-deployed-modules.mjs`
kaldırıyor. "Erişilebilir"in nasıl tanımlandığı o dosyanın başlığında yazıyor — yalnızca
manifest okuyan bir taramanın göremeyeceği tek kırılma sınıfıyla birlikte: hiç bildirmediği bir
modülü `require` eden bir paket, eskiden pnpm'in düz hoist'i üzerinden çözülüyordu, artık
çözülmeyecek. Bunun statik bir kontrolü yok; olan şey `SENTRY_DSN`, `SMTP_HOST` ve `REDIS_URL`
ayarlıyken bir boot — varsayılan yapılandırmayla açılışın hiç dokunmadığı kodu çalıştıran şey
bu. `migrate` imajı ise build stage'inin tamamı
olmaktan (workspace, her paketin tüm dev bağımlılıkları, pnpm'in kendisi) çıkıp Prisma CLI,
şema ve migration'ları taşıyan temiz bir tabana dönüştü. Sayıların hepsini `docker build -f
apps/api/Dockerfile --target runner .` ardından sonucun `docker history` ve
`docker image ls --tree` çıktısıyla yeniden üretebilirsin.

Geriye kalanın büyük kısmı bize ait değil: `node:24-alpine` bu imajların her birinde 171 MB yer
tutuyor (Alpine 9.31 MB, Node 156 MB, Yarn 5.48 MB) — API imajının %42'si. Bunu kesmek farklı
bir taban demek ve taban taşıyıcı bir parça: `docker-compose.yml`'deki healthcheck, container
içinde çalışan bir busybox `wget` — distroless bir imajda bu yok.

Next.js, `NEXT_PUBLIC_*` değerlerini build zamanında client bundle'a gömer; dolayısıyla
yayınlanmış bir imaj bunları `api`'nin `DATABASE_URL`'i gibi container başlangıcında alamaz. Bu
framework'ün bir özelliği ve değişmedi — değişen şey, gömülen değerin artık dağıtıma özgü
olmaması. İmaj `NEXT_PUBLIC_API_URL=/api` taşır; bu, sayfayı sunan origin üzerindeki bir yoldur
ve `proxy` arkasında her hostname'de doğrudur — **aynı imaj her domain'de yeniden build
edilmeden çalışır**. Gerekçenin tamamı:
[Neden yeniden build gerekmiyor](self-hosting.md#neden-yeniden-build-gerekmiyor); kodu için
`apps/web/lib/api-url.ts`.

Sentry DSN'leri hâlâ gerçekten build zamanlıdır: tarayıcı hata takibini açıp kapatmak `web`'i
yeniden build etmeyi gerektirir (`docker compose build web`, `NEXT_PUBLIC_SENTRY_*`'i
`.env`'den okur), yalnızca yeniden başlatmayı değil. `NEXT_PUBLIC_API_URL` bilinçli olarak o
`args:` bloğunda **değildir**; böylece lokal bir build, geliştirme döngüsünün `.env`'de
bıraktığını sessizce gömmek yerine release imajıyla aynı bundle'ı üretir. API'yi gerçekten kendi
hostname'inde isteyen bir dağıtım build arg'ını doğrudan geçer ve domain'e özgü bir imajı kabul
eder:

```bash
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
```

Bu aynı zamanda veritabanını zamanlanmış olarak dump'layan `backup` sidecar'ını da başlatır —
bkz. [Yükseltme ve yedekleme](#yükseltme-ve-yedekleme). `docker-compose.dev.yml`'de böyle bir
servis yok: geliştirme döngüsünün veritabanı tasarım gereği atılabilir.

|                                 | Geliştirme döngüsü | Tam Docker                                                       |
| ------------------------------- | ------------------ | ---------------------------------------------------------------- |
| Hot reload                      | Evet               | Hayır — rebuild gerekir                                          |
| Kod değişikliği sonrası başlama | saniyeler          | onlarca saniye                                                   |
| Production'a benzerlik          | Kısmen             | Evet                                                             |
| Kullanım amacı                  | Günlük geliştirme  | Image'ları doğrulama, release kontrolleri, uygulamayı çalıştırma |

## Container sertleştirme

Her iki compose dosyasındaki her servis, dosyaların başındaki `x-hardened` YAML anchor'ı
üzerinden tüm Linux capability set'i düşürülmüş (`cap_drop: [ALL]`) ve
`no-new-privileges:true` ayarlanmış olarak çalışır. Bir container'ın varsayılan capability
seti — `CAP_NET_RAW`, `CAP_SYS_PTRACE`, `CAP_CHOWN` ve bir düzine daha fazlası — hangi işletim
sistemi kullanıcısıyla çalıştığından bağımsız olarak saldırı yüzeyidir: bir kod-çalıştırma
açığı, uygulamanın kendi inisiyatifiyle düşürdüğü değil, kernel'in container'a verdiği her
şeyi devralır. Bu, 2026-08-13 denetiminin SEC-02 bulgusunun ikinci yarısıdır; artık
[ROADMAP.md](../../ROADMAP.md#hardening-track)'a katıldı. Birinci yarı — her iki Dockerfile'ın
runner stage'inde `USER node`, yani `api`/`web`'in baştan root olarak çalışmaması — PR #109'da
tamamlandı.

Bir capability yalnızca bir servis düşürülmüş haliyle gerçekten çalıştırılıp başarısız
olduğu gözlemlendiğinde geri eklenir, "muhtemelen gerekir" diye değil. Compose
dosyalarındaki her `cap_add:` yanındaki yorum, o kararı gerektiren gerçek hatayı taşır;
kısa özeti:

| Servis       | `cap_add`                                             | Neden                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`, `web` | yok                                                   | Zaten `USER node` — container'ın ömrü boyunca hiçbir noktada `chown`, `setuid` veya ayrıcalıklı port bind'i yok                                                                                                                                                                                                                                       |
| `migrate`    | yok                                                   | O da `USER node`: imaj küçültme çalışması bu stage'e root sahipli `build` stage'i yerine kendi temiz tabanını verdi. Yalnızca DB'ye bağlanır ve yanına kopyalanan şema ile migration'ları okur                                                                                                                                                        |
| `backup`     | yok                                                   | `entrypoint:`, postgres imajının kendi entrypoint'ini tamamen değiştiriyor, dolayısıyla chown/re-exec mantığı hiç çalışmıyor — sidecar root kalır ama hiçbir sahiplik değiştirmiyor                                                                                                                                                                   |
| `postgres`   | `CHOWN`, `FOWNER`, `SETUID`, `SETGID`, `DAC_OVERRIDE` | Resmî entrypoint her zaman root olarak başlar, _her_ açılışta (yalnızca ilkinde değil) `PGDATA`'yı `postgres` kullanıcısına `chown`'lar, sonra `gosu postgres` ile kendini yeniden exec eder — `DAC_OVERRIDE` özellikle ikinci açılıştan itibaren gerekir: `PGDATA` artık `chmod 0700` olduğunda root bu izin olmadan içine `find` ile bile giremiyor |
| `redis`      | `SETUID`, `SETGID`                                    | Entrypoint, `setpriv` ile uid 999'a ayrıcalık düşürür — ama yalnızca ilk argümanı harfiyen `redis-server` olduğunda; aşağıya bakın                                                                                                                                                                                                                    |
| `proxy`      | `NET_BIND_SERVICE`                                    | Caddy container içinde 80 ve 443 portlarını bind eder. Yetenek düşürüldüğünde bind anında değil exec anında başarısız olur (`exec /usr/bin/caddy: operation not permitted`): imaj binary'yi `cap_net_bind_service=+ep` dosya yetenekleriyle gönderir ve çekirdek, bounding set dışındaki böyle bir binary'yi exec etmeyi reddeder                     |

**redis'in `command:`'i exec form'dur, shell wrapper değil — ve bu kozmetik bir tercih değil.**
Bu sertleştirme turunun ilk taslağı, `REDIS_PASSWORD`'u opsiyonel tutmak için
`command: ['sh', '-c', 'if [ -n "$REDIS_PASSWORD" ]; then …; fi']` kullanıyordu. Bu,
container'ın entrypoint'ine ilk argüman olarak `redis-server` yerine `sh`'ı veriyordu — tam
olarak entrypoint'in kendi ayrıcalık-düşürme kontrolünün baktığı şey bu. Dolayısıyla düşürme
sessizce hiç çalışmadı ve redis-server ömrü boyunca root olarak kaldı. Review sırasında
`docker top` ile yakalandı (`docker exec ... id` ile değil — o, PID 1'in gerçek çalışma
zamanı kullanıcısını değil, imajın `USER` yönergesinden gelen _exec session_'ın kullanıcısını
raporlar; yanlış araç aynı çıktıyı verip hatayı gizlerdi). Bu, `REDIS_PASSWORD`'u sabit bir
varsayılan olmadan opsiyonel yapmak için `sh -c` wrapper'ını ekleyen PR #166'dan kaynaklanan
gerçek bir gerilemeydi.

Düzeltme `command: ['redis-server', '--requirepass', '${REDIS_PASSWORD:-}']` — dizi (exec)
formu, Compose'un kendisi tarafından config zamanında değiştiriliyor (`${REDIS_PASSWORD:-}`,
bu dosyada başka yerlerde bir container'ın kendi shell'inin çalışma zamanında çözdüğü
değerler için kullanılan `$$` kaçışı değil). `redis-server` yeniden ilk argüman olarak literal
şekilde geldiğinde entrypoint'in tespiti yeniden eşleşiyor, `setpriv --reuid redis --regid
redis` çalışıyor, ve bu işlemin ihtiyaç duyduğu capability'ler (`SETUID`, `SETGID`) bu
belgenin önceki bir sürümünde anlatılan `DAC_OVERRIDE`'ın yerini alıyor — `DAC_OVERRIDE`,
root olarak çalışmayı telafi ediyordu; süreç artık uid 999 olup `/data`'ya (imajın bu şekilde
bakladığı) doğrudan sahipken hiçbir override gerekmiyor. `docker top`'un `root ...
redis-server` yerine `999 ... redis-server` göstermesiyle, ve hem şifreli hem şifresiz
durumda değerin sağlam kaldığı bir `SET` → restart döngüsüyle doğrulandı.

Bu sertleştirme turunun kapsamı dışında: salt-okunur kök dosya sistemi (`read_only: true`)
ve seccomp profilleri. İkisi de hangi yolların yazılabilir kalması gerektiğine dair
servis-bazlı bir denetim isteyen daha katı kısıtlar (geçici dizinler, node'un kendi `/tmp`
kullanımı vb.); [ROADMAP.md](../../ROADMAP.md#hardening-track)'ın Hardening hattında takip
işi olarak izleniyor, buraya dahil edilmedi.

## pnpm script'leri

Repository kökünden çalıştırın.

| Script           | Komut                 | Ne yapar                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap`      | `pnpm bootstrap`      | Taze clone (veya taze pull) → çalışan dev loop: paylaşılan paketler, Prisma client, container'lar, migration'lar, demo veri. Idempotent; halihazırda workspace tutan bir veritabanını yeniden seed'lemez. `--seed` / `--no-seed` bunu geçersiz kılar. `pnpm setup` **değil** — o, shell profilinize yazan yerleşik bir pnpm komutudur                                              |
| `dev`            | `pnpm dev`            | `apps/api` ve `apps/web`'i hot reload ile paralel çalıştırır                                                                                                                                                                                                                                                                                                                       |
| `build`          | `pnpm build`          | Her workspace paketini build eder                                                                                                                                                                                                                                                                                                                                                  |
| `lint`           | `pnpm lint`           | Tüm paketlerde ESLint                                                                                                                                                                                                                                                                                                                                                              |
| `format`         | `pnpm format`         | Repo genelinde Prettier write                                                                                                                                                                                                                                                                                                                                                      |
| `format:check`   | `pnpm format:check`   | Prettier check (CI kapısı)                                                                                                                                                                                                                                                                                                                                                         |
| `typecheck`      | `pnpm typecheck`      | `@kurul/shared-types` + `@kurul/auth-access` build, ardından her workspace'te `tsc --noEmit`                                                                                                                                                                                                                                                                                       |
| `test`           | `pnpm test`           | Tüm workspace paketlerinin test suite'lerini çalıştırır                                                                                                                                                                                                                                                                                                                            |
| `db:generate`    | `pnpm db:generate`    | `prisma generate`'i çalıştırır: Prisma client'ı şemadan (yeniden) üretir. Migration'lara veya veritabanına dokunmaz. Klonlama sonrasında ve başkasının yaptığı şema/migration değişikliklerini pull'ladıktan sonra gereklidir                                                                                                                                                      |
| `db:migrate`     | `pnpm db:migrate`     | `prisma migrate deploy`'u çalıştırır: var olan, zaten commit edilmiş migration'ları uygular. Asla migration oluşturmaz ve client'ı asla yeniden üretmez — CI/production için güvenlidir. Bunu yalnızca yeni migration'ları pull'ladıktan sonra çalıştırdıysanız, ardından `pnpm db:generate` çalıştırın                                                                            |
| `db:migrate:dev` | `pnpm db:migrate:dev` | `prisma migrate dev`'i çalıştırır: yerel şemanızı diff'ler, **yeni bir migration dosyası oluşturur**, uygular ve client'ı yeniden üretir. `schema.prisma`'yı düzenledikten sonra yerelde çalıştırmanız gereken komut budur — `db:migrate` tek başına onu oluşturmaz                                                                                                                |
| `db:seed`        | `pnpm db:seed`        | Demo veriyi yükler: bir workspace, bir board, varsayılan column'lar, birkaç task. Prisma 7 altında seed giriş noktası `prisma.config.ts` içinde deklare edilir — seeding hiçbir zaman otomatik değildir ve açıkça çağrılmalıdır                                                                                                                                                    |
| `db:studio`      | `pnpm db:studio`      | http://localhost:5555 adresinde Prisma Studio'yu açar                                                                                                                                                                                                                                                                                                                              |
| `db:drift`       | `pnpm db:drift`       | `prisma migrate diff --from-config-datasource --to-schema apps/api/prisma/schema.prisma --exit-code`'u çalıştırır: yapılandırılmış veritabanını `schema.prisma` ile karşılaştırır ve herhangi bir farkta sıfırdan farklı çıkışla sonlanır. CI'nin `db:migrate`'ten sonra çalıştırdığı komutla aynıdır — bkz. [Migration sapmasını kontrol etme](#migration-sapmasını-kontrol-etme) |

Tek bir workspace'i hedeflemek için pnpm'in filter flag'ini kullanın:

```bash
pnpm --filter @kurul/api dev
pnpm --filter @kurul/web build
pnpm --filter @kurul/api test
```

## Veritabanı iş akışı

```bash
# 1. apps/api/prisma/schema.prisma dosyasını düzenle
# 2. Bir migration oluştur, uygula ve client'ı yeniden üret
pnpm db:migrate:dev
# 3. Demo veriyi yükle (boş board'lara karşı geliştirmek zor)
pnpm db:seed
# 4. Veriyi incele
pnpm db:studio
```

Migration'ı oluşturmak için `pnpm db:migrate` değil, `pnpm db:migrate:dev` kullanın —
`db:migrate` yalnızca zaten var olan migration'ları uygular (`prisma migrate deploy`) ve şema
değişikliğinizden bir tane oluşturmaz. `db:migrate:dev` ayrıca Prisma client'ı da yeniden
üretir, dolayısıyla burada ayrı bir `pnpm db:generate` adımına gerek yoktur.

Bunun yerine başkasının zaten commit ettiği migration'ları alıyorsanız (örn. `git pull`
sonrası), `pnpm db:migrate` ardından `pnpm db:generate` kullanın — `db:migrate` onları uygular
ama `db:migrate:dev`'in aksine client'ı yeniden üretmez.

Kurallar:

- Migration'lar **commit edilir**. Zaten commit edilmiş bir migration dosyasını asla
  düzenlemeyin — yeni bir tane yazın.
- Pratikte mümkün olduğunda, şema değişiklikleri onları kullanan logic'ten ayrı kendi
  PR'ında olur.
- `Task.position` ve `Column.position` `Float`'tır (fractional indexing) — özensizce değiştirilmemesi gereken
  model seviyesi kurallar için [architecture.md](architecture.md#kritik-alan-kuralları)'ye bakın.

### Migration sapmasını kontrol etme

Karşılığında migration'ı hiç almamış bir şema değişikliği doğası gereği sessizdir: yerelde hiçbir
şey bozulmaz, uyuşmazlık ancak bir sonraki `prisma migrate dev`'in çıkarmak istediği ilgisiz
statement'lar olarak yüzeye çıkar. `pnpm db:drift` bunu beklemeden doğrudan yakalar:

```bash
pnpm db:migrate   # önce veritabanını en son commit edilmiş migration'a getir
pnpm db:drift     # sonra schema.prisma ile karşılaştır
```

`prisma migrate diff --from-config-datasource --to-schema apps/api/prisma/schema.prisma
--exit-code`'u çalıştırır; uyuştuklarında "No difference detected." yazar ve 0 ile çıkar, aksi
halde uyuşmazlığı yazıp sıfırdan farklı bir kodla çıkar. Ayrı bir shadow veritabanı yoktur:
`--from-config-datasource`, `prisma.config.ts`'teki datasource'u (yani `DATABASE_URL`'i)
doğrudan şemayla karşılaştırır — CI'nin de aynı job içinde `db:migrate`'ten hemen sonra
çalıştırdığı şey budur, bkz. [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) —
dolayısıyla yerelde geçmesiyle CI'de geçmesi aynı anlama gelir.

Yerel bir veritabanını sıfırdan sıfırlamak:

```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:seed
```

### Büyük board seed'lemek

Varsayılan seed dört task'tır; bir özellik geliştirmek için doğru, board'un yük altında ne
yaptığını görmek için yanlış boyuttur. `SEED_LARGE_BOARD_TASKS`, demo board'un yanına ikinci
bir board ekler — "Load Test Board", beş column, en büyüğü task'ların yaklaşık üçte birini
tutar:

```bash
SEED_LARGE_BOARD_TASKS=1000 pnpm db:seed
```

Boş ya da `0` (varsayılan) bunu tamamen atlar; istemeyen kimse bedelini ödemez. Pozitif tam
sayı olmayan her değer clamp'lenmek yerine "boş" sayılır: bir yazım hatası, ölçmek üzere
olduğunuzdan başka boyutta bir board'u sessizce seed'lememelidir.

Satırlar tekdüze değil gerçekçidir — karışık öncelikler, kartların yaklaşık yarısında label,
dörtte birinde atanan kişi, due-soon penceresinin içine ve gerisine yayılmış son tarihler —
çünkü her kartın aynı şekilde olduğu bir board tek bir kart şeklini ölçer.
[`apps/web/components/board/board-column.tsx`](../../apps/web/components/board/board-column.tsx)
içindeki column başına render bütçesi bu board'a karşı ölçüldü.

## Veri saklama

Kurul artık saklamaya hakkı olmayan satırları siler. Bir BullMQ işi `REDIS_URL` üzerinde
**günde bir kez** koşar — due-soon taramasıyla aynı mekanizma — ve altı tabloyu, artı attachment
dizinini süpürür:

| Tablo                 | Ne zaman silinir                              | Ayar                                            |
| --------------------- | --------------------------------------------- | ----------------------------------------------- |
| `Session`             | `expiresAt` geçtiğinde                        | yok — yapılandırılabilir değil                  |
| `Verification`        | `expiresAt` geçtiğinde                        | yok — yapılandırılabilir değil                  |
| `Notification`        | okunmuşsa ve N günden önce okunmuşsa          | `NOTIFICATION_RETENTION_DAYS` (varsayılan `90`) |
| `Activity`            | N günden önce yazılmışsa                      | `ACTIVITY_RETENTION_DAYS` (varsayılan `365`)    |
| `UsagePing`           | N günden önce yazılmışsa                      | `ACTIVITY_RETENTION_DAYS` (varsayılan `365`)    |
| `WorkspaceInvitation` | sonuçlanmışsa ve N günden önce oluşturulmuşsa | `INVITATION_RETENTION_DAYS` (varsayılan `90`)   |

**Bir davetin "sonuçlanmış" olmasının iki yolu var ve ikisi de sayılır:** birileri yanıtlamıştır
(`status`, `pending` dışında bir şeydir) ya da `expiresAt`'i geçmiştir. Süresi henüz dolmamış bir
`pending` davet, birilerinin hâlâ kabul edebileceği canlı bir erişim hakkıdır; bu yüzden hangi
yaşta olursa olsun silinmez. Pencere `createdAt`'ten ölçülür, çünkü bu tablonun sahip olduğu tek
zaman damgası odur — `resolvedAt` diye bir alan yok. Bu, kaydı yanıt anından ölçmeye kıyasla bir
miktar erken siler; fark, bir satırın `pending` kalabileceği süreyle sınırlıdır.

Bu süpürme var, çünkü `WorkspaceInvitation.email` bu şemada kurulumun bir kullanıcısına ait
olmak zorunda olmayan tek adrestir: hiç kayıt olmayan birini davet edin, silinecek bir hesap
oluşmaz ve satır o adresi süresiz saklardı. Bir hesabın silinmesi artık o hesaba gönderilmiş her
daveti de — hangi durumda olursa olsun — kaldırır; bkz.
[ADR 0026](decisions/0026-account-deletion-anonymisation.md).

Yedinci süpürmenin tablosu yok. **Hiçbir satırın sahiplenmediği attachment dosyaları silinir**;
bunlar `Workspace → Board → Task → Attachment` zincirinin tümüyle Postgres içinde cascade
etmesinden doğar: bir board silindiğinde binlerce attachment satırı tek satır uygulama kodu
koşmadan kaybolabilir, yani byte'ları silecek hiçbir şey çalışmaz. `STORAGE_PATH` tanımsızsa
süpürme hiç koşmaz, ve yalnız `BACKUP_KEEP × BACKUP_INTERVAL` kadarlık bir **grace period**'dan
daha eski dosyalara bakar — o iki değer ne derse desin asla 24 saatin altına inmez, çünkü satırı
henüz commit edilmemiş bir dosya da hiçbir satırın sahiplenmediği bir dosyadır. Raporladığı
sayı `orphanedFiles`; bir depolama anahtarı attachment'ın kimliği olduğu için bu bir sayıdır,
asla anahtar listesi değil.

`UsagePing` bilerek kendi penceresini taşımak yerine `ACTIVITY_RETENTION_DAYS`'i paylaşır: aynı
sınıf satırdır — bir kullanıcıyı adlandıran kurulum geçmişi — ve tek bir veri sınıfı üzerindeki
iki ayar ancak birbiriyle çelişebilir. O tablonun ne sakladığı (kişi, workspace, tür ve UTC gün
başına tekilleştirilmiş tek satır) ve bilerek neyi saklamadığı için bkz.
[ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md).

Her pencerenin ardındaki gerekçe — ve `Activity`'nin neden arşivlenmek ya da süresiz
saklanmak yerine bir yıl sonra silindiği — [ADR 0020](decisions/0020-data-retention.md)'de.

Bunlardan birini değiştirmeden önce bilinmesi gereken iki şey:

- **Okunmamış bildirimler hangi yaşta olursa olsun silinmez.** Pencere `createdAt`'ten değil,
  `readAt`'ten ölçülür. Süresi dolmamış `pending` davetler de aynı muafiyete sahiptir.
- Her pencere için de **`0` "sonsuza dek sakla" demektir.** Yasal bir denetim izi
  yükümlülüğünüz varsa `ACTIVITY_RETENTION_DAYS=0` yapın. Negatif bir değer kırpılmaz,
  başlangıçta reddedilir — gelecekte bir kesim noktası olurdu ve canlı satırları silerdi.

Her koşu stdout'a, tablo başına silinen satır sayısını taşıyan tek bir JSON satırı yazar —
başka hiçbir şey yok: kimlik yok, payload yok:

```json
{
  "ts": "2026-08-14T03:00:01.204Z",
  "level": "info",
  "event": "retention.cleanup",
  "durationMs": 41.8,
  "sessions": 132,
  "verifications": 9,
  "notifications": 2140,
  "activities": 0,
  "usagePings": 0,
  "invitations": 4,
  "orphanedFiles": 0
}
```

Satır her sayı sıfır olsa bile yazılır; böylece satırın yokluğu, işin koşmayı bıraktığının
işareti olur.

`CLEANUP_ENABLED=false` süpürmeyi tamamen kapatır ve bunu yalnızca başlangıçta değil, silme
anında yapar — daha eski bir deployment'ın Redis'te bıraktığı bir iş tanımı anahtarı
aşamaz. Entegrasyon suite'i bu anahtar kapalı koşar (`apps/api/test/setup-e2e.ts`) ve yalnızca kendi
doğrulamalarının çevresinde açar; global ve zamanlanmış bir `DELETE`, fixture'ları geçmişe
tarihlenmiş bir suite'in arka planında koşmasını isteyeceğiniz bir şey değil.

Silme batch'lidir (statement başına 1000 satır); böylece uzun süredir çalışan bir instance'ta
ilk koşu, kilitleri tutan ve autovacuum'u engelleyen tek bir uzun transaction'a dönüşmez.

## Aktivasyon hunisi ve telemetri

Ayrı ayrı kararlaştırılmış iki ayrı şey ve aralarındaki fark, her ikisinden de önemli. Tam
gerekçe: [ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md).

### 1. Aktivasyon hunisi — burada hesaplanır, size gösterilir, hiçbir yere gönderilmez

Kurul, kurulumunuzun zaten tuttuğu satırlardan on bir adımlık bir aktivasyon hunisi türetir;
yanında bir de Kuzey Yıldızı metriği: **Haftalık Aktif Takım Workspace'i** — iki veya daha fazla
üyesi olan ve son yedi günde iki veya daha fazla mevcut üyesi bir şey yapmış workspace'ler.

| #   | Adım                 | Sayı nereden geliyor                                              |
| --- | -------------------- | ----------------------------------------------------------------- |
| 1   | `user_registered`    | `COUNT(User)`                                                     |
| 2   | `workspace_created`  | `role = OWNER` olan distinct `WorkspaceMember.userId`             |
| 3   | `board_created`      | `board.created` aktivitesindeki distinct aktörler                 |
| 4   | `first_task_created` | `task.created` üzerindeki distinct aktörler                       |
| 5   | `first_drag`         | `task.moved` üzerindeki distinct aktörler                         |
| 6   | `invite_sent`        | `invitation.created` üzerindeki distinct aktörler                 |
| 7   | `smtp_configured`    | bu dağıtımın SMTP aktarımı var mı (kişi sayısı değil)             |
| 8   | `invite_accepted`    | `invitation.accepted` distinct aktörleri — aktör davet edilendir  |
| 9   | `dashboard_viewed`   | `UsagePing`'de `dashboard_view` satırı olan distinct kullanıcılar |
| 10  | `task_completed`     | Bir kartı `COMPLETED` kolona taşıyan distinct aktörler            |
| 11  | `wau_board_view`     | Son 7 günde `board_view` satırı olan distinct kullanıcılar        |

On birin dokuzu `Activity`, `User` ve `WorkspaceMember`'dan okunur — ürünün kendi nedenleriyle
zaten yazdığı tablolar — dolayısıyla huni yükseltmeden bu yana geçen süreyi değil, kurulumunuzun
tüm geçmişini kapsar. Yalnızca 9. ve 11. adımlar kendi depolamasını gerektirdi, çünkü `Activity`
değişiklikleri kaydeder ve _bir board'u okumak bir değişiklik değildir_: onlar olmadan, her sabah
board'unu açıp hiçbir şeyi düzenlemeyen bir takım ölü olarak raporlanırdı.

Her adım **distinct kişi** sayar, asla olay değil; tek istisna dağıtımın bir özelliği olan 7.
adımdır. `smtp_configured` bilerek "davet gönderildi" ile "davet kabul edildi" arasında durur:
mail aktarımı olmadan davetli adresini doğrulayamaz ve dolayısıyla hiç kabul edemez (bkz.
[SMTP ve Mailpit](#smtp-ve-mailpit) ve
[ADR 0013](decisions/0013-invitation-email-verification.md)); oradaki bir sıfır, aksi hâlde ürün
sorunu gibi görünecek bir düşüşü açıklar.

**Buradaki hiçbir şey sunucunuzdan çıkmaz.** İstek anında hesaplanır ve diğer her şeyle aynı API
üzerinden oturum açmış tek bir çağırana döner.

#### Kimler görebilir

Siz söyleyene kadar hiç kimse:

```dotenv
INSTANCE_ADMIN_EMAILS=siz@example.com,ops@example.com
```

Varsayılan olan boş değer, uç noktanın herkese — makinedeki her workspace'in sahibi olan hesap
dahil — `403` yanıtı vermesi demektir. Vermek zorunda: kaydın açık olduğu bir kurulumda
"workspace sahibi" her ziyaretçinin bir workspace oluşturarak kendine verebileceği bir roldür,
yani hiçbir workspace rolü sınır olamazdı. Adresler büyük/küçük harf duyarsız eşleşir; listeyi
değiştirmek için yeniden başlatma gerekir.

Listelenen bir adres, yalnızca o hesabın kendi e-postası doğrulanmışsa erişim kazanır. Kurul
oturum açmak için e-posta doğrulaması istemez ve silinen bir hesabın adresi yeni bir kayıt için
serbest bırakılır — yani bir adresi buraya yazmak, tek başına onu korumaz: posta kutusunun
sahipliğini ilk kanıtlayan kişi, bu listenin kabul ettiği kişidir.

Ayarlandıktan sonra huni, o hesaplar için **Ayarlar** ekranının altında görünür; başka kimse için
görünmez. Uygulama içinden yetki vermenin bir yolu yoktur.

### 2. Dışa telemetri — kapalı ve siz açmadıkça kapalı kalır

```dotenv
TELEMETRY_ENABLED=false          # varsayılan
TELEMETRY_ENDPOINT=              # varsayılanı yok; yukarıdaki anahtara ek olarak gerekli
```

`TELEMETRY_ENABLED=false` ile — ki dokunulmamış bir `.env` bu demektir — **hiçbir dışa istek
yapılmaz**. `true` yapıp `TELEMETRY_ENDPOINT` ayarlamamak hata loglar ve yine hiçbir şey
göndermez; yerleşik bir toplayıcı adresi bilerek yoktur.

Açtığınızda, API süreci başlarken tam olarak bir `POST` yapılır; gövdesi şudur ve **başka hiçbir
şey içermez**:

```json
{
  "event": "instance_started",
  "version": "0.1.0"
}
```

Alan alan, listenin tamamı budur:

| Alan      | Değer                | Not                                             |
| --------- | -------------------- | ----------------------------------------------- |
| `event`   | `"instance_started"` | Her zaman bu düz metin. Tek bir olay vardır     |
| `version` | örn. `"0.1.0"`       | Bu derlemenin geldiği `@kurul/api` paket sürümü |

Gönderil**mey**en ve gönderilmesi için kod yolu bulunmayanlar: herhangi bir kurulum kimliği,
hostname'iniz, IP adresiniz, URL'iniz, veritabanınız, kullanıcı/workspace/board/task sayıları,
yukarıdaki aktivasyon hunisinin herhangi bir parçası ve herhangi bir kişiye dair herhangi bir
şey. Oturum yok, çerez yok, parmak izi yok ve ikinci bir istek yok — yeniden deneme yok, kuyruk
yok, zamanlama yok. Yük gönderilmeden önce tamamen loglanır, böylece sunucunuzdan neyin çıktığını
kendi API log'unuzda okuyabilirsiniz:

```text
LOG [TelemetryService] TELEMETRY_ENABLED is on — sending {"event":"instance_started","version":"0.1.0"} to https://…
```

Reddedilen bağlantı, DNS hatası, toplayıcıdan gelen hata ya da zaman aşımı
(`TELEMETRY_TIMEOUT_MS`, varsayılan 5sn) — hepsi tek bir uyarı satırı üretir, başka hiçbir şey;
telemetri açılışı asla geciktiremez ya da düşüremez.

Kurulum kimliği olmadığı için bir toplayıcı kurulumları değil _başlangıçları_ sayabilir. Bu,
güvene dayalı hiçbir şey içermeyen bir söz karşılığında bilerek verilen bir hassasiyet kaybıdır;
takas [ADR 0021](decisions/0021-activation-funnel-and-opt-in-telemetry.md)'de tartışılıyor.

## Yükseltme ve yedekleme

Bu, önemsediği veriyle Kurul çalıştıran herkes için geçerlidir, atılabilir yerel
veritabanları için değil. 1.0 öncesi, kırıcı şema değişiklikleri herhangi bir `0.y.0`
release'inde gelebilir ([git-strategy.md](git-strategy.md#versiyonlama-politikası-semver)),
dolayısıyla iki kural var: zamanlanmış yedeğin çalışmasına izin verin ve **her yükseltmeden
hemen önce bir dump daha alın.**

### Zamanlanmış yedekleme sidecar'ı

`docker compose up`, `postgres`'in yanında bir `backup` servisi de başlatır.
[`scripts/backup.sh`](../../scripts/backup.sh)'i bir `postgres:18-alpine` container'ında
çalıştırır — sunucuyla aynı image, yani `pg_dump`/`pg_restore` her zaman sunucu major'ıyla
eşleşir — ve döngüye girer:

1. `pg_dump --format=custom` ile `backup_data` volume'üne
   `/backups/kurul-<UTC timestamp>.dump` yazar (önce `.part` olarak yazılır, başarıda
   yeniden adlandırılır; yarıda kesilen bir dump asla tamamlanmış bir arşiv gibi görünmez),
2. `/attachments` altında salt-okunur bağlanmış attachment volume'ünü `tar -czf` ile
   `/backups/kurul-<AYNI UTC timestamp>-files.tar.gz` olarak arşivler. Ortak damga, bir
   restore'un hangi tar'ın hangi dump'a ait olduğunu bilme yoludur,
3. **her iki seride de** en yeni `BACKUP_KEEP` arşivinden eskisini siler,
4. `BACKUP_INTERVAL` saniye uyur, tekrarlar.

**Dosya arşivi bir snapshot değildir ve bu sınır varsayılmaz, ölçülür.** `pg_dump`
veritabanının tutarlı bir görüntüsünü alır; `tar` dizini gezerken ne görürse onu alır, yani
arşiv koşarken yüklenen bir dosya arşivin içinde yarım kalabilir. `.part`+yeniden adlandırma
disiplini yarım kalmış bir _arşivi_ gizler, yarım kalmış bir _dosyayı_ değil. Pencere,
`BACKUP_INTERVAL` başına attachment dizininin bir `tar`'ıdır ve aşağıdaki restore tatbikatı bu
durumu, geri yüklenen her dosyanın boyutunu satırındaki `size` ile karşılaştırarak yakalar —
tek başına bir sayım yakalayamaz, çünkü kesilmiş bir dosya da bir dosyadır. Pencereyi gerçekten
kapatmak LVM/ZFS snapshot'ı ya da arşiv boyunca yüklemeleri durdurmak demektir; tek makinelik
bir Compose kurulumu ikisini de taşımaz.

Varsayılanlar — günde bir dump, yedi tanesi saklanır — **en fazla 24 saatlik bir kurtarma
noktası (RPO ≤ 24 sa) ve bir haftalık geçmiş** demektir; host'ta cron yok, hatırlanacak bir
şey yok. Servis `restart: unless-stopped`: yeniden başlatmadan sonra ayağa kalkmayan bir
yedekleme sidecar'ı sessizce kurtarma noktası üretmeyi bırakır ki bu bölümün var olma sebebi
tam olarak bu hatadır. `docker-compose.dev.yml`'de bilinçli olarak **yok** — `pnpm db:seed`'in
istendiğinde sildiği yerel bir veritabanında saklanmaya değer bir şey yoktur.

İki ayar, ikisi de compose tarafından `.env`'den okunur:

| Değişken          | Varsayılan | Amaç                                                                       |
| ----------------- | ---------- | -------------------------------------------------------------------------- |
| `BACKUP_INTERVAL` | `86400`    | Döngüler arası saniye. `86400` = günlük; bu **doğrudan** sizin RPO'nuzdur  |
| `BACKUP_KEEP`     | `7`        | Her seride saklanan arşiv sayısı; her döngüden sonra daha eskileri silinir |

Compose bu ikisini `api` servisine de geçirir — yedekleme ayarı gibi okunduğu için gözden
kaçması kolaydır: gece koşan yetim dosya süpürmesi, bir dosyayı sahiplenmeyi bırakacak kadar
eski bir dump hâlâ restore edilebilirken o dosyayı silmeyi reddeder ve bu grace period tam
olarak `BACKUP_KEEP × BACKUP_INTERVAL`'dır. "Diskte var, veritabanında yok" ancak veritabanı
otorite olduğu sürece doğru bir yargıdır; bir restore satırları geri sarar, disk olduğu yerde
kalır. Yani iki değişkenden birini kısaltmak, bir restore'un o süpürmeden güvende olduğu
pencereyi de kısaltır. **Ama asla 24 saatin altına inmez**: bu ikisi ne derse desin API pencereyi
bir güne sabitler, çünkü grace period aynı zamanda byte'ları diske yazılmış ama satırı henüz
yazılmakta olan bir yüklemeyi de korur — ve bunun yedeklemeyle ilgisi yoktur, hiç dump almamış
bir kurulumda da vardır. Bkz. [ADR 0022](decisions/0022-attachment-storage.md).

Kontrol edin — test edilmemiş bir yedek yedek değildir, okunmamış bir log da öyle:

```bash
docker compose logs backup | tail            # döngü başına iki "wrote /backups/kurul-…" satırı
docker compose exec backup ls -lh /backups   # en yeni çift ve kaç tanesi saklanıyor
```

Döngü başına bir değil iki satır: yalnızca dump'ı loglayan bir döngü, dosya arşivinin
başarısız olduğu (ya da `ATTACHMENT_DIR`'in boş olduğu) anlamına gelir; üstündeki `ERROR`
satırı hangisi olduğunu söyler.

**Arşivleri host dışına kopyalayın.** `backup_data`, `postgres_data` ile aynı diskte durur;
yani "yanlış tabloyu düşürdüm"ü kapsar, ölen bir diski veya kaybolan bir sunucuyu hiç
kapsamaz — volume'ü düzenli olarak başka bir yere aynalayın
(`docker compose exec -T backup cat /backups/<arşiv>` üzerinden ya da doğrudan volume'ün host
yolundan `rsync`/`rclone`), yoksa felaket senaryosu yine her şeyi kaybettirir.

### Elle dump almak

Bir yükseltmeden önce ya da kurtarma noktasını `BACKUP_INTERVAL` sonra değil şimdi istediğiniz
her an, aynı script'i bir kez çalıştırın — her iki arşivi de aynı volume'e, tek bir damga
altında yazar ve aynı kurala göre budar:

```bash
docker compose exec backup /bin/sh /usr/local/bin/backup.sh once
```

Volume dışında bir kopya tutmak için (yükseltme öncesi önerilir, çünkü
`docker compose down -v`'den sağ çıkar) — dump ve yanında dosyalar:

```bash
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T postgres \
  pg_dump -U kurul --format=custom kurul > "kurul-$stamp.dump"
docker compose run --rm -T --entrypoint tar backup -czf - -C /attachments . \
  > "kurul-$stamp-files.tar.gz"
```

İkisi için tek bir `stamp`, sidecar'ın tek damga paylaşmasıyla aynı sebeple: çift yalnız
birlikte işe yarar ve hangi dump'a ait olduğunu söyleyemediğiniz bir tar, satırı olmayan bir
dosya dizinidir.

- Önce hedef sürümün `CHANGELOG.md` girdisini okuyun — her kırıcı değişiklik orada bir
  migration notu taşır.
- Sonra image'ları yükseltin ve migration'ları çalıştırın.
- Yükseltme ters giderse, bkz. [Geri alma (rollback)](#geri-alma-rollback).

### Yedekten geri dönme

**Hedef: restore kararından itibaren iki saatin altında ayakta olmak (RTO ≤ 2 sa).**
Aşağıdaki prosedür küçük bir kurulumda saniyeler sürer; bütçe karar vermek, doğru arşivi
bulmak ve doğrulamak içindir. Uçtan uca prova edilmiştir — `scripts/backup.sh` ile dump'lanıp
arşivlenen bir veritabanı, eşleşen dosya arşiviyle birlikte boş bir sunucuya restore
edildiğinde 20 tablonun tamamını, her satır sayısını, 71 indeksin hepsini, `pg_trgm`'i,
`_prisma_migrations` tablosunu ve **her attachment dosyasını satırındaki bayt boyutuyla**
eksiksiz üretti. Son cümlecik bu tatbikatın büyüdüğü yerdir: satırları geri getirip dosyaları
geride bırakan bir restore, attachment'lardan önce yazılmış her kontrolden geçer.

Restore `pg_restore` iledir (arşivler SQL metni değil `--format=custom`) ve **boş** bir
veritabanı ister — dolu bir veritabanının üzerine restore etmek temiz bir üzerine yazma
değil, duplicate-key hataları üretir.

```bash
# 1. Yazan her şeyi durdurun — yarı restore edilmiş veritabanını dump'layıp iyi bir arşivi
#    rotasyonla düşürmesin diye yedekleme sidecar'ı dahil. Postgres'in kendisi ayakta kalır.
docker compose stop web api backup

# 2. Restore edilecek ÇİFTİ seçin — bir `.dump` ve AYNI damgayı taşıyan `-files.tar.gz`.
#    Sidecar durduğu için `run --rm`; tek kullanımlık container aynı backup_data volume'ünü
#    mount eder.
docker compose run --rm --entrypoint ls backup -1 /backups

# 3. Veritabanını boş olarak yeniden oluşturun. Yıkıcı adım budur — arşiv alındıktan sonra
#    yazılan her şey buradan itibaren gitmiştir.
docker compose exec -T postgres psql -U kurul -d postgres \
  -c 'DROP DATABASE kurul WITH (FORCE);' \
  -c 'CREATE DATABASE kurul OWNER kurul;'

# 4. Restore edin. --exit-on-error, kısmi bir restore'u iyi görünen yarı dolu bir veritabanı
#    yerine gürültülü bir hataya çevirir.
docker compose run --rm --entrypoint pg_restore backup \
  --host=postgres --username=kurul --dbname=kurul \
  --no-owner --exit-on-error /backups/kurul-<timestamp>.dump

# 4b. AYNI damgaya ait attachment dosyalarını geri yükleyin. `backup` servisi volume'ü
#     salt-okunur mount ettiği için bu adımın kendi yazılabilir mount'u gerekir — ve
#     `--user 1000:1000`, çünkü dosyalar api'nin `node` kullanıcısına aittir ve bu stack
#     `cap_drop: [ALL]` ile koşar, bu da root'tan CAP_DAC_OVERRIDE'ı alır. Bayrak olmadan
#     `rm`, adı root olan bir container'da "Permission denied" ile düşer. Tahmin değil, ölçüm.
docker compose run --rm --user 1000:1000 -v kurul_attachment_data:/restore \
  --entrypoint sh backup -c \
  'rm -rf /restore/* && tar -xzf /backups/kurul-<timestamp>-files.tar.gz -C /restore'

# 5. Migration durumunu kontrol edin. Arşiv _prisma_migrations'ı taşıdığı için kayıtlı durum
#    restore edilen şemayla eşleşir ve bunun yapacak bir şey bulmaması beklenir.
docker compose run --rm migrate

# 6. Trafiği geri almadan önce doğrulayın: şema, satır sayıları ve dosyaların geri geldiği.
docker compose exec -T postgres psql -U kurul -d kurul \
  -c '\dt' \
  -c 'SELECT count(*) FROM "User";' \
  -c 'SELECT count(*) FROM "Workspace";' \
  -c 'SELECT count(*) FROM "Task";' \
  -c 'SELECT count(*) FROM "Attachment" WHERE kind = '"'"'FILE'"'"';' \
  -c 'SELECT count(*) FROM "_prisma_migrations";'
docker compose run --rm --entrypoint sh backup -c 'find /attachments -type f | wc -l'

# 6b. Ve geri gelen her dosyanın satırındaki boyutta olduğu. `tar`'ın hâlâ yazılırken
#     kopyaladığı bir dosyayı yakalayan şey budur — tek başına bir sayım yakalayamaz: kesilmiş
#     bir dosya da bir dosyadır.
#
#     Bilinçli olarak düz POSIX: `diff <(…) <(…)` değil, geçici dosyalar ve `diff a b`. Process
#     substitution bir bash/zsh özelliğidir ve bu blok kimsenin itiraf ettiğinden daha sık
#     `sh` içine yapıştırılır; orada yedeğin bozulduğu izlenimi veren bir sözdizimi hatasıyla
#     düşer.
#
#     `find -printf` değil, `find -exec stat -c`: backup container'ı postgres:18-alpine'dir ve
#     BusyBox `find`'ın `-printf`'i yoktur. Tek komut, seçenek değil — bir operatör restore'un
#     ortasında taşınabilirlik kararı vermek zorunda kalmamalı.
docker compose exec -T postgres psql -U kurul -d kurul -At \
  -c 'SELECT "storageKey" || '"'"' '"'"' || "size" FROM "Attachment" WHERE kind = '"'"'FILE'"'"';' \
  | sort > /tmp/expected.txt
docker compose run --rm --entrypoint sh backup -c \
  'cd /attachments && find . -type f -exec stat -c "%n %s" {} + | sed "s|^\./||"' \
  | sort > /tmp/actual.txt
diff /tmp/expected.txt /tmp/actual.txt && echo "her dosya kayıtlı boyutuyla geri geldi"

# 7. Stack'i geri getirin.
docker compose up -d
```

Tatbikat iki değil **üç** şey üzerinden geçer:

1. `FILE` attachment satır sayısı diskteki dosya sayısına eşit,
2. 6b'deki `diff` boş — her dosya satırındaki boyutta,
3. arşiv alınırken bir yükleme yapıldıysa fark **yalnızca** o penceredeki dosyalarda çıkabilir
   ve `diff` onları isimleriyle raporlar. Sessiz bir fark asla kabul edilmez: raporlanırsa
   yukarıdaki "`tar` snapshot değildir" sınırı ölçülmüş olur, raporlanmazsa yalnızca yazılmış.

4b'deki `kurul_attachment_data`, volume'ün Compose'un proje adıyla öneklediği tam adıdır —
dizininizin adı `kurul` değilse `docker volume ls`.

Checkout edilmiş kod arşivin şemasından yeniyse, 5. adım eksik migration'ları ileri doğru
uygular; bu doğrudur. **Eskiyse**, 5. adımdan önce arşive karşılık gelen release tag'ine
geçin — bkz. [Geri alma (rollback)](#geri-alma-rollback).

Volume'dekinin yerine host tarafındaki bir dosyadan restore (4. adımın varyantı):

```bash
docker compose run --rm -T --entrypoint pg_restore backup \
  --host=postgres --username=kurul --dbname=kurul --no-owner \
  --exit-on-error < kurul-20260813T194856Z.dump

# Dosya yarısı, aynı fikir (4b'nin varyantı) — yazılabilir mount ve aynı CAP_DAC_OVERRIDE
# sebebiyle uid 1000.
docker compose run --rm -T --user 1000:1000 -v kurul_attachment_data:/restore \
  --entrypoint sh backup -c 'rm -rf /restore/* && tar -xzf - -C /restore' \
  < kurul-20260813T194856Z-files.tar.gz
```

**PostgreSQL major sürüm yükseltmeleri bir dump ve restore gerektirir.** Resmi `postgres`
imajı, `PGDATA` volume'ü farklı bir major sürüm tarafından initialize edildiğinde başlamayı
reddediyor ("database files are incompatible with server"); volume kendini migrate etmiyor.
Bir major'dan sonrakine geçmek için: eski image'da `pg_dump`, yeni major'ı boş bir volume'e
karşı başlatın, dump'ı `psql`/`pg_restore` edin. Minor yükseltmeler (18.4 → 18.5) yerinde
yapılır ve dump gerektirmez — yukarıdaki upgrade-öncesi yedek yine de sağlıklı bir alışkanlık.

**Redis yedeklenmez.** Cache, session'lar, rate-limit sayaçları, Socket.io pub/sub
fan-out'u ve bildirim kuyruğunu tutar — hepsi yeniden inşa edilebilir. Onu kaybetmek
herkesin oturumunu kapatır ve henüz teslim edilmemiş kuyruklanmış bildirimleri düşürür;
hiçbir board verisini kaybetmez. Redis yükseltmeleri bir major içinde, ve 7 → 8, yerinde
ve RDB/AOF uyumludur.

**Attachment dosyaları ise tam tersi sebeple yedeklenir.** `attachment_data`, bu stack'te ne
Postgres'te duran ne de ondan yeniden üretilebilen tek bayt yığınıdır: kaybolan bir volume'den
satır sağ çıkar, indirme çıkmaz. Sidecar'ın onu dump'ın yanında arşivlemesinin ve yukarıdaki
tatbikatın satırlar kadar dosyaları da kontrol etmesinin sebebi budur — ADR 0020 soğuk-depolama
arşivlemesini "aynı diskte duran, kimsenin okumadığı ve kimsenin geri yüklemediği bir dosya"
diye reddetmişti; cevap bu dosyaların kullanıcıya görünür olması değil, bu kopyanın yanındaki
dump ile aynı prova edilmiş takvimde okunup geri yüklenmesidir.

### Bir hesap silmesini geri almak

**Üründe geri alma yok ve cevabın tamamı bu.** `DELETE /me` ve
`DELETE /instance/users/:userId`, `User` satırını yerinde anonimleştirir ve yalnızca o kişiye
ait olan satırları hard delete eder ([ADR 0026](decisions/0026-account-deletion-anonymisation.md)).
İkisi de anında çalışır ve ikisi de uygulamadan geri alınamaz — bu bilinçli, çünkü sessizce geri
sarılabilen bir silme talebi silme değildir.

Yani kurtarma yolu dump ve bu, yukarıdaki geri yükleme tatbikatının **tek farkla** kendisi:
canlının üzerine değil, geçici bir veritabanına geri yükleyin. Arşiv alındığından beri yazılan
her şey canlı veritabanında duruyor ve tam geri yükleme, tek bir satırı kurtarmak için hepsini
çöpe atardı.

```bash
# 1. Silmeden önceki en yeni dump'tan, canlının yanına geçici bir veritabanı.
docker compose exec -T postgres psql -U kurul -d postgres \
  -c 'CREATE DATABASE kurul_recovery OWNER kurul;'
docker compose run --rm --entrypoint pg_restore backup \
  --host=postgres --username=kurul --dbname=kurul_recovery \
  --no-owner --exit-on-error /backups/kurul-<timestamp>.dump

# 2. Hesabı bulun. Silmenin yazdığı log satırı yalnızca id taşır —
#    `docker compose logs api | jq 'select(.event == "account.deleted")'` — oradan başlayın;
#    o id'yi yeniden bir isme çeviren şey geçici veritabanıdır.
docker compose exec -T postgres psql -U kurul -d kurul_recovery \
  -c 'SELECT id, email, name FROM "User" WHERE id = '"'"'<userId>'"'"';'
```

Geri kopyalanabilenler ve kopyalanamayanlar:

| Satır                                             | Kurtarılabilir mi                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `User` (email, name, avatarUrl, locale)           | Evet — canlı veritabanında `UPDATE "User" SET … WHERE id = …` ve `deletedAt`'i temizleyin          |
| `Account` (parola hash'i)                         | Evet — satırı geri kopyalayın ya da kişiye parolasını sıfırlatın                                   |
| `WorkspaceMember`                                 | Workspace'ler hâlâ duruyorsa evet; `account.deleted` payload'ının kaydettiği rolle yeniden ekleyin |
| Mention'ları yeniden yazılmış `Comment` gövdeleri | Evet — eski gövde dump'ta                                                                          |
| `Activity.payload.targetName`                     | Evet, aynı şekilde                                                                                 |
| **Bir kararın sildiği workspace**                 | **Yalnızca dump'tan, toptan.** Cascade oldu — board'lar, task'lar, yorumlar, hepsi                 |
| Adresi taşıyan `WorkspaceInvitation` satırları    | **Yalnızca dump'tan.** Hesaba gönderilmiş her davet silinir — her durumda, her workspace'te        |
| `Session`                                         | Hayır, gereği de yok: kişi yeniden giriş yapar                                                     |

**Davet satırları bu listedeki en yeni kalem ve silmenin anonimleştirmek yerine gerçekten sildiği
tek şey.** Tablonun iki tarafına da dokunulur: hesabın _gönderdiği_ bekleyen davetler geri alınır
(silinmiş bir hesap kimseye kefil olmaya devam edemez) ve hesaba _gönderilmiş_ her davet, hangi
durumda olursa olsun doğrudan silinir — çünkü o satır, başkasının bir olaya dair kaydı değil,
ayrılan kişinin kendi iletişim bilgisinin bir kopyasıdır
([ADR 0026](decisions/0026-account-deletion-anonymisation.md)).

Birini geri kopyalamak neredeyse hiçbir zaman istediğiniz şey değildir: adresi yeniden davet etmek
taze bir son kullanma tarihiyle taze bir erişim izni üretir — yöneticinin zaten istediği şey budur.
Dump yalnızca tarihsel soru için okunmaya değer: bu kişi o workspace'e hiç davet edilmiş miydi, kim
tarafından. Ayrıca gecelik süpürmenin bitmiş davetleri kendi takvimiyle sildiğini unutmayın
(`INVITATION_RETENTION_DAYS`); o pencereden eski bir dump'ta satır zaten olmayabilir.

**Attachment baytları sağ çıkar** ve üzerlerinde bir saat işliyor. Bu akış dosya sistemine hiç
dokunmaz, dolayısıyla dosyalar yerinde — ama gecelik orphan süpürmesi, hiçbir satır sahiplenmedi
ve bekleme penceresi geçtiyse depolanmış dosyayı siler
(`BACKUP_KEEP × BACKUP_INTERVAL`, en az 24 saat — [ADR 0022](decisions/0022-attachment-storage.md)).
Silinmiş bir workspace geri yüklenecekse **o pencerenin içinde** yükleyin; yoksa satırlar artık
olmayan dosyaları göstererek geri gelir. `docker compose stop api` zaman kazandırır: süpürme API
sürecinde çalışır.

İşiniz bitince geçici veritabanını düşürün — instance'ın verisinin tam bir kopyası, instance'ın
yanında duruyor:

```bash
docker compose exec -T postgres psql -U kurul -d postgres \
  -c 'DROP DATABASE kurul_recovery WITH (FORCE);'
```

### İndeks migration'ları yazma kilidi alır

**`apps/api/prisma/migrations/` içindeki her indeks düz bir `CREATE INDEX` ile oluşturulur ve
bu, inşa boyunca tablo üzerinde bir `SHARE` kilidi tutar.** Okumalar sürer; **o tabloya
yazmalar indeks bitene kadar bloke olur.** Taze veya küçük bir veritabanında bu milisaniyeler
sürer ve görünmezdir. Büyük bir veritabanında ise inşa süresi kadar uzun bir yazma kesintisidir.

En kritik olan ikisi, `20260809190000_task_trgm_search_indexes` içindeki trigram GIN
indeksleridir: `Task_title_idx` ve `Task_description_idx`. Metin üzerindeki GIN inşaları var
olan en yavaş indeks inşaları arasındadır ve `Task`, şemadaki en hızlı büyüyen tablodur.

Bu bilinçli bir takas, bir gözden kaçırma değil. `CREATE INDEX CONCURRENTLY` bir transaction
bloğu içinde çalışamaz ve `prisma migrate deploy` her migration'ı bir transaction'a sarar —
yani onu kullanmak, Prisma'nın uygulayamayacağı migration'ları elle yazmak anlamına gelirdi;
karşılığında ise bu projenin fiilen deploy edildiği her veritabanında fark edilmeyen bir kilit
kazanılırdı. Prisma'nın bu durum için kendi önerisi de aşağıdaki manuel yoldur.

**Büyük bir `Task` tablosu olan (kabaca: birkaç yüz bin satırı geçmiş) bir kurulumu ya da
yazma duraklaması kaldıramayacak herhangi bir kurulumu yükseltmeden önce:**

1. Uygulamadan önce sürümdeki yeni migration'ları okuyun:
   `git diff <mevcut-tag>..<hedef-tag> -- apps/api/prisma/migrations`.
2. Biri büyük bir tabloda indeks oluşturuyorsa, eski sürüm hâlâ trafiğe hizmet ederken o
   ifadeyi `CONCURRENTLY` ile kendiniz uygulayın:

   ```bash
   docker compose exec -T postgres psql -U kurul kurul -c \
     'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_title_idx" ON "Task" USING GIN ("title" gin_trgm_ops);'
   ```

   `CONCURRENTLY` yazmaları bloke etmez, ama bir transaction içinde çalışamaz ve kabaca iki
   kat uzun sürer. Başarısız olursa geride **geçersiz** bir indeks bırakır; yeniden denemeden
   önce bunun düşürülmesi gerekir (`DROP INDEX CONCURRENTLY "Task_title_idx";`) — kontrol
   için: `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`.

3. Sonra her zamanki gibi `pnpm db:migrate` çalıştırın. Migration'ın kendi `CREATE INDEX`'i,
   aynı adla zaten var olan bir indekse karşı no-op'tur, dolayısıyla deploy hiç kilit almaz.

Bunu rutin olarak yapmayın — normal boyuttaki bir kurulum için tek başına 3. adım doğrudur ve
tüm prosedür boşa emektir. Bu, yalnızca varsayılanın canı yakacağı tek durum için, sürüm
notlarıyla tetiklenen bir kaçış kapısıdır.

Aynı migration'daki `CREATE EXTENSION IF NOT EXISTS pg_trgm` superuser veya
`pg_database_owner` yetkisi ister. Eklentileri kısıtlayan yönetilen bir Postgres'te,
migration çalışmadan önce `pg_trgm`'in sağlayıcı tarafından etkinleştirilmiş olması gerekir.

## Geri alma (rollback)

Bir yükseltme veya release ters gittiğinde ve bilinen son sağlam sürümün geri gelmesi
gerektiğinde ne yapmalı. Geri alınması gerekebilecek iki farklı şey vardır ve bunlar
birbirinden bağımsız hareket eder: **uygulama** (container'ların çalıştırdığı kod) ve
**veritabanı şeması** (uygulanmış Prisma migration'ları). Uygulamayı geri almak ucuz ve
hızlıdır; bir migration'ı geri almak değildir — migration kısmını, gece 2'de ihtiyacınız
olmadan önce okuyun.

### Uygulamayı geri almak

`api`/`web`, her etiketli release'te GHCR'a yayınlanır (bkz.
[Docker'da tam stack](#dockerda-tam-stack)), dolayısıyla geri almak bir rebuild değil, bir tag
değişikliğidir:

```bash
# .env
TAG=v0.1.0   # bilinen son sağlam tag — yayınlanmış sürümleri `git tag -l` ile listeleyin
```

```bash
docker compose pull && docker compose up -d   # v0.1.0'ın image'larını çeker ve onlarla yeniden başlatır
```

O tag için yayınlanmış bir image yok mu (bu workflow var olmadan önce yükseltilmiş eski
kurulumlar, veya `ghcr.io`'ya erişilemiyor)? O zaman daha önce tek seçenek olan kaynak
rebuild'e dönün:

```bash
git fetch --tags
git switch --detach v0.1.0        # bilinen son sağlam tag — `git tag -l` ile listeleyin
docker compose up -d --build      # api + web'i o ağaçtan yeniden build et ve yeniden başlat
```

One-shot `migrate` servisi her `up`'ta çalışır, ama yalnızca checkout edilmiş ağaçta var olan
migration'ları **uygular** (`prisma migrate deploy`) — veritabanında olup ağaçta olmayan
migration'ları asla geri çevirmez. Yani bir kod geri almasından sonra veritabanı yeni şemayı
korur. Kötü release'in migration'ları tamamen ekleyiciyse (yeni tablolar, yeni nullable
kolonlar, yeni indeksler), eski kod o şemaya karşı sorunsuz çalışır ve kod geri alması tek
başına tüm prosedürdür. Kötü release, eski kodun okuduğu bir şeyi yeniden adlandırdıysa veya
düşürdüyse, yalnızca kodu geri almak açılışta çöker — bu, aşağıdaki migration geri alma
durumudur.

### Bir migration'ı geri almak

**Prisma down migration üretmez.** `apps/api/prisma/migrations/` altındaki her dizin yalnızca
ileri yönlü bir `migration.sql` içerir; bir `migrate down` komutu ve otomatik bir geri alma
yolu yoktur. Seçenekler, tercih sırasıyla:

1. **Forward-fix (tercih edilen).** Kötü değişikliği geri alan veya onaran **yeni** bir
   migration yazın — kötü kolonu düşürün, eski adı geri getirin, veriyi backfill edin —
   yerelde `pnpm db:migrate:dev` ile oluşturun ve her zamanki gibi ileri doğru deploy edin.
   Tarih doğrusal kalır, kötü migration'ın kendisinin yok ettiği dışında hiçbir veri atılmaz
   ve commit edilmiş hiçbir migration dosyası asla düzenlenmez. Aşağıdaki hotfix akışıyla
   yayınlayın.
2. **Yedekten restore.** `backup` sidecar'ı size en fazla `BACKUP_INTERVAL` eskilikte
   (varsayılan 24 saat) bir arşiv verir ve [yukarıdaki bölüm](#yükseltme-ve-yedekleme) her
   yükseltmeden hemen önce bir tane daha alın der — burada isteyeceğiniz, o taze arşivdir.
   Arşiv alındıktan sonra yazılan her şey **kalıcı olarak kaybolur**: kurtarma noktası
   `pg_dump`'ın çalıştığı andır, dolayısıyla canlı bir kurulumda bu, şema karşılığında
   kullanıcı verisi takas eder. Kötü migration'ın kendisi, arşivde hâlâ bulunan veriyi yok
   ettiyse (bir kolon veya tablo düşürdüyse) kullanın.

   [Yedekten geri dönme](#yedekten-geri-dönme) adımlarını eksiksiz uygulayın; tek eklemeyle —
   stack'i geri getirmeden önce arşive karşılık gelen release tag'ine geçin ki kod ve şema
   uyuşsun: `.env`'de `TAG=v0.1.0` ayarlayıp `docker compose pull` çalıştırın (bkz.
   [Uygulamayı geri almak](#uygulamayı-geri-almak)), o tag için yayınlanmış image yoksa
   `git switch --detach v0.1.0 && docker compose up -d --build`.

   Arşiv, `_prisma_migrations` defter tablosunu da içerir; dolayısıyla restore'dan sonra
   kayıtlı migration durumu restore edilen şemayla eşleşir ve eski release'in `migrate`
   servisi uygulayacak bir şey bulmaz.

3. **`prisma migrate resolve` — işaretleme, geri çevirme değil.** `resolve` yalnızca
   `_prisma_migrations` defter tablosunu düzenler; hiçbir şemayı değiştirmez ve hiçbir veriyi
   geri getirmez. Senaryosu, **yarı yolda başarısız olmuş** ve artık her `migrate deploy`'u
   bloke eden bir migration'dır: veritabanını elle onarın (veya restore edin), sonra —
   `apps/api` içinden — ya `pnpm exec prisma migrate resolve --rolled-back <migration_adı>`
   (bir sonraki deploy onu yeniden dener) ya da `--applied <migration_adı>` (bir sonraki
   deploy onu atlar). Başarıyla tamamlanmış bir migration'ı "geri almak" için ona uzanmak
   şemaya hiçbir şey yapmaz — bu yanlış kullanım yalnızca defterin yalan söylemesine yol açar.

### Production'da asla `migrate reset`

`prisma migrate reset` tüm veritabanını düşürür ve yeniden oluşturur. Atılabilir yerel veriler
için bir geliştirme döngüsü kolaylığıdır, asla bir rollback aracı değildir — ve production'ı
işaret etmesini engelleyen tek şey shell'inizdeki `DATABASE_URL`'dir. Seed de aynı biçimde bir
tehlikedir: `pnpm db:seed`, demo veriyi eklemeden önce **her tablodaki her satırı** silerek
başlar; bu yüzden [`apps/api/prisma/seed.ts`](../../apps/api/prisma/seed.ts), `NODE_ENV`
`production` iken çalışmayı reddeder
([`apps/api/src/common/seed-guard.ts`](../../apps/api/src/common/seed-guard.ts)) — bilinçli
olarak hiçbir override flag'i yoktur. `migrate reset`'in böyle bir koruması yoktur. Gece
2'deki kural mutlaktır: bu iki komuttan hiçbiri, bir dump'tan yeniden oluşturmayı göze
alamayacağınız bir veritabanına karşı asla çalışmaz.

### Rollback ve hotfix akışı

Rollback zaman kazandırır; çözümün kendisi değildir. Kalıcı çözüm, `main`'den açılan bir
`hotfix/*` branch'i olarak yayınlanır — [git-strategy.md](git-strategy.md#hotfix-süreci):
branch aç, düzelt (yukarıdaki 1. seçenekteki forward-fix migration dahil), patch sürümünü
yükselt, `main`'e PR aç, tag'le, `develop`'a back-merge et, sonra production'ı yeni tag'e
yükselt — rollback'i bitiren şey de budur. Kötü release `v0.2.0` idiyse ve production
`v0.1.0`'da park hâlindeyse, hotfix `v0.2.1` olarak yayınlanır; eski tag'de, onu yayınlamanın
alacağı süreden daha uzun park hâlinde kalmayın.

## Gözlemlenebilirlik

Üç sinyal, üç hedef. Buradaki hiçbir şey bir metrik stack'i değildir — Prometheus yok, Grafana
yok, log toplayıcı yok. Kurul'un ölçeğinde cevaplanmaya değer soru "bir şey bozuldu mu ve
bunu fark eden oldu mu"dur; bunun için tam olarak bu kadarı yeter:

| Sinyal                      | Nereye akar                                                           | Nerede yapılandırılır                              |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| İstek ve süreç log'ları     | konteyner stdout → Docker `json-file`, sınırlandırılmış ve rotasyonlu | `docker-compose.yml` (`x-logging`)                 |
| Yakalanmamış hatalar (5xx)  | Sentry, **yalnızca bir DSN yapılandırdıysanız**                       | `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`            |
| Instance'ın ayakta olmaması | `/health/ready`'yi yoklayan harici bir uptime monitörü                | monitörünüzün paneli — bu repository'de hiçbir şey |

Üçü tek bir tanımlayıcı üzerinde buluşur. Her istek bir `X-Request-Id` alır (upstream bir
proxy gönderiyorsa o yeniden kullanılır, yoksa UUIDv7 üretilir); istemciye geri yansıtılır,
JSON access-log satırına yazılır, sunucu tarafındaki stack trace'e eklenir ve — hata takibi
açıksa — Sentry event'ine aranabilir bir `requestId` tag'i olarak iliştirilir. "Bozuldu, sayfa
`0198e2c1-…` yazdı" diyen bir kullanıcı, tam olarak o hatadan bir `grep` ve bir Sentry
aramasıdır.

### Log'lar

Her iki uygulama da stdout'a loglar; Docker toplar. `docker compose logs -f api` ile geri
okunur.

API her tamamlanan istek için tek bir JSON nesnesi yazar — `ts`, `level`, `requestId`,
`method`, `path`, `status`, `durationMs`, `userId`. Bu alan listesi bilerek kapalıdır: istek
gövdeleri, query string'ler, header'lar ve cookie'ler asla loglanmaz; çünkü bu API session
cookie'leri, davet token'ları ve task içeriği taşır.

Her iki compose dosyasındaki her servis log'larını **3 dosya × 10 MB** ile sınırlar
(`docker-compose.yml` başındaki `x-logging`). Docker'ın `json-file` varsayılanı
_sınırsızdır_ ve dolan bir disk başlı başına bir kesintidir — üstelik bu stack'in kendi
başına ulaşabileceği bir kesinti, çünkü access log trafikle birlikte büyür. Ayar konteyner
**oluşturulurken** uygulanır; bu yüzden mevcut bir dağıtımda etkili olması için
`docker compose up -d` (konteynerleri yeniden oluşturur) gerekir, düz bir `restart` yetmez.
Doğrulama:

```bash
docker inspect kurul-api-1 --format '{{json .HostConfig.LogConfig}}'
# {"Type":"json-file","Config":{"max-file":"3","max-size":"10m"}}
```

### Hata takibi (Sentry) — varsayılan kapalı

Kurul hata takibi **kapalı** gelir ve kapalı olması SDK'nın hiç yüklenmemesi demektir:
initialize yok, global handler yok, dışarı bağlantı yok ve web tarafında ziyaretçinin
tarayıcısının istediği bir Sentry chunk'ı yok. Kimsenin talep etmediği bir telemetri hattını
sessizce açan self-host yazılım bu projenin gönderdiği bir şey değildir; DSN'leri boş bırakmak
desteklenen, kalıcı bir yapılandırmadır.

Açmak için `.env` içinde DSN'leri ayarlayın:

```bash
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>              # API
NEXT_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>  # web
SENTRY_ENVIRONMENT=production            # opsiyonel; boşsa NODE_ENV'e düşer
SENTRY_RELEASE=v0.2.0                    # opsiyonel; dağıttığınız tag'i verin
```

ardından `docker compose up -d --build web && docker compose up -d api`. API DSN'ini
konteyner başlarken okur, bu yüzden restart yeterlidir. Web DSN'i bir `NEXT_PUBLIC_*`
değeridir ve Next.js bunu **build** sırasında gömer — değişikliğin etkili olması için web
imajının yeniden build edilmesi gerekir. (Bu, eskiden `NEXT_PUBLIC_API_URL` için de yeniden
build'i zorunlu kılan aynı mekanizmadır; o artık zorunlu kılmıyor, çünkü gömülen değer bir
dağıtımın hostname'i değil aynı origin'deki bir yol —
bkz. [Docker'da tam stack](#dockerda-tam-stack).)

**İki ayrı Sentry projesi** kullanın, uygulama başına bir tane. Tarayıcı DSN'i her
ziyaretçinin indirdiği JavaScript'e derlenir, dolayısıyla yapısı gereği publiktir; sunucunuzun
kullandığı DSN ile aynı olmamalıdır. Self-host Sentry de aynı şekilde çalışır — DSN yalnızca
kendi host'unuzu işaret eder.

**Ne raporlanır, ne raporlanmaz.** API 5xx'i ve yalnızca 5xx'i raporlar: eşlenmemiş bir Prisma
hatası, fırlatan bir bug, `Error` olmayan bir şeyin `throw`'u. İstemci hataları — 400, 401,
403, 404, 409, 429 — asla gönderilmez. Bunlar API'nin tasarlandığı gibi çalışmasıdır, zaten
access log'da sayılırlar ve ayda binlercesini göndermek bir alarm kanalının okunmaz hâle
gelme biçimidir.

**Süreçten ne çıkar.** `sendDefaultPii` kapalıdır ve bir `beforeSend` hook'u her iki tarafta
da şunları temizler:

- `cookie`, `set-cookie`, `authorization` ve `proxy-authorization` header'ları — yakalanmış bir
  session cookie'si, Sentry projesini okuyabilen herkese verilmiş bir session'dır;
- tüm cookie'ler, istek/yanıt gövdeleri ve query string'ler (`?q=` arama terimleri taşır, ki
  bunlar kullanıcı içeriğidir);
- `user` üzerindeki `id` dışındaki her şey — e-posta yok, kullanıcı adı yok, IP adresi yok.
  `id` opak bir UUIDv7'dir, access log'un zaten yazdığı değerin aynısı.

Korunanlar: exception tipi, mesajı ve stack'i; istek metodu ve route path'i; `requestId`
tag'i; ve `user.id`. **Performans tracing'i ve Session Replay kapalıya sabitlenmiştir**
(`tracesSampleRate: 0`, her iki replay oranı `0`) ve ayar olarak sunulmazlar — replay
render edilmiş DOM'u, yani ekrandaki her task başlığını ve yorumu gönderirdi; tracing ise
SDK'nın uygulama açılmadan önce yüklenmiş olmasını gerektirirdi ki bu "istemediyseniz
yüklenmez" ilkesiyle bağdaşmaz.

**Source map'ler.** Sentry build eklentisi yalnızca `NEXT_PUBLIC_SENTRY_DSN` ayarlıyken
çalışır ve o zaman bile `SENTRY_AUTH_TOKEN` da yoksa hiçbir şey yüklemez — yani token'sız bir
build asla kırılmaz ve uyarı da vermez. Yükleme olmadan tarayıcı stack trace'leri minified
kalır; okunabilir olmaları için build sırasında `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` ve
`SENTRY_PROJECT` ayarlayın. Eklentinin kendi build-time telemetrisi koşulsuz kapalıdır.

### Uptime izleme — kesintiyi asıl yakalayan bu, kurun

Restart politikaları çöken bir konteyneri geri getirir, ama host'un kendisi düştüğünde, disk
dolduğunda veya Postgres bağlantı kabul etmeyi bıraktığında size bunu söyleyen hiçbir şey
yoktur. Harici bir monitör, izlediği makineden sağ çıkan tek sinyaldir ve herhangi birinin
ücretsiz katmanı yeterlidir.

**`/health`'i değil, `/health/ready`'yi izleyin.** İkisi farklı soruları yanıtlar:

| Endpoint        | Soru                                                                                                | Davranış                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/health`       | Süreç ayakta mı ve HTTP'ye yanıt veriyor mu?                                                        | Statik `{"status":"ok"}` — hiçbir şeye dokunmaz. Node yaşıyorsa hep 200 |
| `/health/ready` | Bu instance gerçekten istek karşılayabiliyor mu — Postgres erişilebilir mi, Redis yanıt veriyor mu? | `checks` dökümüyle `200`, ya da bir bağımlılık düştüyse `503`           |

`/health` bir liveness probe'udur: bir orkestratörün süreci yeniden başlatmanın işe yarayıp
yaramayacağına karar vermek için kullandığı şeydir ve veritabanı yanarken bilerek yeşil kalır,
çünkü restart veritabanını iyileştiremez. Onu izlemek, hiçbir kullanıcının board açamadığı bir
kesinti sırasında size API'nin "ayakta" olduğunu söylerdi. `/health/ready` ise ürün gerçekten
bozulduğunda kızaran endpoint'tir ve yanıt gövdesi hangi bağımlılığın düştüğünü söyler. İkisi
de publiktir (auth yok) ve rate limit'ten muaftır, böylece bir monitör kendini throttle edip
yanlış alarm üretemez.

Kurulum — örnek olarak [UptimeRobot](https://uptimerobot.com) veya
[healthchecks.io](https://healthchecks.io); bir URL'yi yoklayıp e-posta gönderebilen her
monitör olur:

1. `https://<host-unuz>/api/health/ready` için bir **HTTP(s) monitörü** oluşturun.

   Dağıtılmış bir stack'te `/api` ön eki isteğe bağlı değildir ve onu atlamak, fark edilmesi en
   zor biçimde başarısız olur. Pakete dahil `proxy`, `/api/*`'ı API'ye, geri kalan her şeyi web
   uygulamasına yönlendirir (`docker/Caddyfile`); dolayısıyla `https://<host-unuz>/health/ready`
   catch-all kuralına düşer, Next.js'e varır ve `307` ile `/login`'e yönlendirir. Aşağıdaki 4. kural karşısında bu monitör, sapasağlam bir örnekte kırmızıdır — ve doğal çözüm, yani
   kabul edilen durum kodlarını susana kadar genişletmek, onu gerçek bir kesinti sırasında da
   yeşil yapar. Yalnızca kendi portunda, önünde proxy olmadan çalışan dev döngüsü API'sine
   `http://localhost:4000/health/ready` adresinden erişilir.

2. **Aralık: 5 dakika.** Gece yaşanan bir kesintiyi sabaha kalmadan yakalayacak kadar hızlı,
   her ücretsiz katmanın içinde kalacak kadar yavaş.
3. Alarm öncesi **eşik: art arda 2 başarısız yoklama** — bir deploy veya
   `docker compose up -d` sırasında kaçan tek bir yoklama olay değildir ve kurt masalı anlatan
   bir alarm kanalı susturulur.
4. **Beklenen durum: 200.** `/health/ready`'den gelen bir `503` gerçek bir bağımlılık
   arızasıdır ve "down" sayılmalıdır; kabul edilen aralığı "herhangi bir 2xx/3xx/5xx" diye
   genişletmeyin.
5. **Zaman aşımı: 10 saniye.** Readiness probe'u kendi bağımlılık kontrollerini ~2s ile
   sınırlar, dolayısıyla bundan yavaş olan her şey ağ ya da takılmış bir süreçtir.
6. Bir **e-posta alarm kişisi** ekleyin ve "tekrar ayakta" bildirimini de açın — ne zaman
   düzeldiğini bilmek, ne olduğunu bilmenin yarısıdır.
7. **Bir kez bilerek tetikleyin** ve mailin geldiğini doğrulayın:
   `docker compose stop postgres`, iki aralık bekleyin, kırmızı alarmı görün, sonra
   `docker compose start postgres` ile toparlanma mailini bekleyin. Hiç tetiklenmemiş bir
   alarm kurulumu bir güvence değil, bir varsayımdır.

API henüz internetten erişilebilir değilse healthchecks.io'nun _push_ modeli alternatiftir:
sizden ses **kesildiğinde** alarm verir; host tarafında bir cron, hiçbir şeyi dışa açmadan özel
bir dağıtımı kapsar. Yoklamayı, container'ın kendi healthcheck'i gibi, yayınlanmış bir port
üzerinden değil ağın içinden yapın — Docker dağıtımında API'nin yayınlanmış portu yoktur:

```cron
*/5 * * * * cd /opt/kurul && docker compose exec -T api wget -qO- http://127.0.0.1:4000/health/ready >/dev/null && curl -fsS <ping-url>
```

## Günlük döngü

```bash
# 1. Güncel bir develop'tan başla ve dallan
git switch develop && git pull
git switch -c feature/board-drag-and-drop

# 2. Servisleri ayağa kaldır (session başına bir kez)
docker compose -f docker-compose.dev.yml up -d
pnpm dev

# 3. Kod + test yaz

# 4. Push etmeden önce yerelde doğrula
pnpm lint
pnpm build
pnpm --filter @kurul/api test

# 5. Conventional Commits formatında, İngilizce commit at
git commit -m "feat(web): add drag-and-drop to the kanban board"

# 6. Push et ve develop'a karşı bir PR aç
git push -u origin feature/board-drag-and-drop
```

CI, her PR'da aynı lint, typecheck ve test adımlarını çalıştırır — bunları önce yerelde
çalıştırmak sadece bir gidiş-dönüşten tasarruf ettirir. Branch adlandırma, commit formatı ve
PR/release süreci [git-strategy.md](git-strategy.md)'de belirtilmiştir.

## Sorun giderme

| Belirti                                                 | Sebep                                                             | Çözüm                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ECONNREFUSED 127.0.0.1:5432`                           | Postgres container'ı ayakta değil                                 | `docker compose -f docker-compose.dev.yml up -d`                                                      |
| `Environment variable not found: DATABASE_URL`          | `.env` eksik                                                      | `cp .env.example .env` ve doldur                                                                      |
| 3000/4000/5432 portu zaten kullanımda                   | Başka bir process veya eski bir container                         | `docker compose down`, veya `.env`'de portu değiştir                                                  |
| Pull sonrası Prisma tipleri güncel değil                | Client yeniden üretilmedi — `pnpm db:migrate` onu yeniden üretmez | `pnpm db:generate` (yeni migration'ları `pnpm db:migrate` ile uyguladıktan sonra)                     |
| Yeni üretilen client devreye girmiyor                   | Çalışan `pnpm dev` `dist`'teki eski client'ı tutar                | `pnpm db:generate` sonrası `pnpm dev`'i yeniden başlatın — asset'ler (yeniden) başlangıçta kopyalanır |
| `pnpm install` bir workspace hatasıyla başarısız oluyor | Bir alt-paket içinde çalıştırıldı                                 | Repository kökünden çalıştırın                                                                        |

## Ayrıca bakınız

- [architecture.md](architecture.md) — bu dokümanın kontratı olduğu modül haritası ve
  kritik alan kuralları
- [self-hosting.md](self-hosting.md) — bir release'i kendi domain'inize kurmak: DNS, HTTPS, SMTP
- [../../ROADMAP.md](../../ROADMAP.md) — faz sırası
- [git-strategy.md](git-strategy.md) — branch'ler, commit'ler, release'ler
- [coding-standards.md](coding-standards.md) — bu uygulamaların içindeki kodun nasıl
  yazıldığı
- [testing.md](testing.md) — testlerin nasıl çalıştırılacağı ve yazılacağı
- [../CONTRIBUTING.md](../../CONTRIBUTING.md) — katkı süreci
