# Kurul

Açık kaynak, Kanban odaklı proje yönetim aracı.

[![CI](https://github.com/dravcore/kurul/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/dravcore/kurul/actions/workflows/ci.yml) [![CodeQL](https://github.com/dravcore/kurul/actions/workflows/codeql.yml/badge.svg?branch=develop)](https://github.com/dravcore/kurul/actions/workflows/codeql.yml) [![Sürüm](https://img.shields.io/github/v/release/dravcore/kurul)](https://github.com/dravcore/kurul/releases) [![Lisans](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

![Kurul panosu](docs/assets/board.png)

> 🌐 [English (canonical)](README.md) | Türkçe

## Durum

Kurul’ın **MVP özellik seti (Faz 1–9) tamamlandı** (Faz 0 docs/standartlardı) — auth/workspace’ler, board ve
task’lar, filtreleme, dashboard, aktivite/bildirimler ve realtime board senkronu. Bkz.
[ROADMAP.md](ROADMAP.md). Kritik tarayıcı akışlarını yedi senaryoluk bir
Playwright smoke paketi kapsıyor ([docs/tr/testing.md](docs/tr/testing.md#browser-uçtan-uca)).
MVP ötesi maddeler (e-posta bildirimleri, presence, ek diller, …) hâlâ MVP ötesi altında
listelenir.

## Kurul nedir?

**Kurul**, toplanıp konuşan, karar alan ve önündeki işi kendi arasında bölüşen heyettir. Bu
aracın bir ekip için yaptığı şey de tam olarak bu: insanlar bir board etrafında toplanır, işi
konuşur, neyin önemli olduğuna karar verir ve görevleri aralarında paylaştırır — herkes için
izlenebilir, önceliklendirilmiş ve görünür şekilde.

Proje v0.2.0'a kadar **Kurultay** adını taşıyordu — Türk-Moğol geleneğinde boyların toplanıp
meseleleri tartıştığı, karar aldığı büyük meclis. Kısa ad aynı fikri ve aynı kökü koruyor, ve
projenin artık üzerinde yaşadığı domain'e uyuyor.

Kurul, verisinin ve iş akışının sahibi olmak isteyen ekipler için ticari Kanban/PM
araçlarına (Trello, Linear, Jira) kendi kendine barındırılabilir, AGPL lisanslı bir
alternatif olmayı hedefliyor.

## Neden Kurul

Kendi kendine barındırılan bir board seçen ekipler bunu genelde Trello ile değil, diğer
self-host seçenekleriyle kıyaslar. Bugün o alanın durumu:

| Proje                                                            | Durumu                                                                                                                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Planka](https://github.com/plankanban/planka)                   | Kaynağı görünür ama artık OSI uyumlu açık kaynak değil — "fair-code distributed under the Fair Use License and PLANKA Pro/Enterprise License" |
| [WeKan](https://github.com/wekan/wekan)                          | Tümüyle açık kaynak (MIT), ücretli katman yok; Meteor tabanlı stack (Meteor 3.5 / Node.js 24)                                                 |
| [Focalboard](https://github.com/mattermost-community/focalboard) | "This repository is currently not maintained" — geliştirme yalnızca Mattermost eklentisi olarak sürüyor                                       |
| [Vikunja](https://vikunja.io/pricing/)                           | Çekirdek AGPLv3, ama admin paneli, audit log'ları ve zaman takibi kendi barındırdığınız instance'ta bile yalnız Pro'da                        |
| [OpenProject](https://www.openproject.org/pricing/)              | GPLv3 Community Edition, Rails tabanlı ve kurumsal ölçekli; bir grup özellik Enterprise'a özel kalıyor                                        |

Kurul'un cevabı bilinçli olarak dar:

- **Tek lisans, tek katman.** Kod tabanının tamamı AGPL-3.0, hiçbir şey saklı değil. Ticari
  model isteğe bağlı bir barındırma servisi; ücretli bir özellik sürümü değil. Kendi sunucunuzda
  çalıştırmak ücretsiz ve eksiksiz
  ([ADR 0028](docs/tr/decisions/0028-open-contributions-hosted-service.md)).
- **Güncel stack, tek compose dosyası.** Next.js 16 / NestJS 11 / PostgreSQL 18, uçtan uca
  TypeScript, tamamı için `docker compose pull && docker compose up -d` — yayınlanmış
  image'lar, lokal build gerekmiyor.
- **Realtime ve çok-kiracılılık çekirdekte.** Socket.io board senkronu ve workspace'e
  scope'lanmış sorgular sonradan eklenmedi, baştan tasarlandı.

Ve `v0.3.0` itibarıyla olmayanlar: subtask yok, zaman takibi yok, public API token'ları ve
webhook'lar yok. UI hem İngilizce hem Türkçe konuşuyor — her arayüz metni, yeni bir board'un
başladığı column adları ve size gönderdiğimiz e-posta dahil — ve üçüncü bir dil bir katalog
uzakta. API token'ları, webhook'lar ve ek dil paketleri
[MVP ötesi](ROADMAP.md#beyond-mvp) altında, her biri kendisini bekleten açık soruyla
listeli; subtask ve zaman takibi ise o listede hiç yok. Bunlara bugün ihtiyacınız varsa
yukarıdaki daha olgun projelerden biri daha iyi bir seçim.

## Özellikler

MVP’de gelenler — sıralama geçmişi için [ROADMAP.md](ROADMAP.md):

- **Board'lar ve kolonlar** — sürükle-bırakla yeniden sıralanabilen klasik Kanban düzeni
- **Task'lar** — çoklu atanan kişi, label'lar, (label'lardan bağımsız tutulan) priority,
  ayrı alanlar olarak due date ve süre tahmini
- **Checklist'ler** — bir task'ta birden çok adlandırılmış checklist, her birinin kendi
  item'ları; board kartında ilerleme rozeti (`3/5`) görünür, task'ta checklist yoksa hiç
  görünmez ([ADR 0023](docs/tr/decisions/0023-checklist-data-model.md))
- **Ek'ler** — kartta dosya ve bağlantı. Dosyalar kendi diskinizde saklanır, uzantısına değil
  magic byte'larına bakılarak kabul edilir ve sizin belirlediğiniz boyut limitiyle geri servis
  edilir; görseller panelde önizlenir. Bağlantı saklanır, gösterilir ve açılır — sunucu o URL'e
  hiç istek atmaz, yani hiçbir önizleme fetch'i ağınızı yoklayan bir araca dönüşemez
  ([ADR 0022](docs/tr/decisions/0022-attachment-storage.md),
  [ADR 0024](docs/tr/decisions/0024-attachment-kinds-and-serving-policy.md))
- **Trello import'u (tek yönlü)** — bir Trello board'unun JSON export'unu yükleyin, karşılığında
  bir Kurul board'u alın: list'ler, kart'lar, label'lar ve checklist'ler. Tek yönlüdür ve
  tekrarlanabilir değildir: **aynı export'u iki kez import etmek iki board yaratır** — yerinde
  güncelleme de yok, tekilleştirme de. Üç şey bilinçli olarak gelmez ve import raporu her birinin
  kaç tane olduğunu söyler: **dosyalar** (Trello export'u attachment'ların baytlarını değil
  URL'lerini taşır, dolayısıyla bağlantı olarak gelirler ve sunucu o URL'lere hiç istek atmaz),
  **üyeler** (bir Trello hesabı bir Kurul hesabı değildir; atamalar düşer ve her şey sizin
  üzerinize yazılır) ve **yorumlar**. Arşivlenmiş list ve kartlar da atlanır, ve içe aktarılan her
  kolon "başlanmadı" olarak gelir — Kurul hangi kolonunuzun "bitti" demek olduğunu asla tahmin
  etmez, onu sonradan siz ayarlarsınız. Rapor yalnız cevabın içindedir: bir kez gösterilir,
  saklanmaz, kapatmak kalıcıdır
  ([ADR 0025](docs/tr/decisions/0025-trello-import-mapping.md))
- **Fractional-indexed sıralama** — bir kartı yeniden sıralamak yalnızca o kartın position'ına
  dokunur, tüm listeyi yeniden numaralandırmaz
- **Workspace'ler** — temelden itibaren multi-tenant; her sorgu workspace'e göre scope'lanır
- **Filtreleme ve arama** — board task filtreleri, cursor pagination
- **Dashboard** — agregasyon görünümleri ve grafikler (created vs completed dahil)
- **Aktivite log'u ve bildirimler** — atama, mention, due-soon; uygulama içi ve e-postayla (kullanıcı başına anahtar); `/notifications`
- **Realtime senkronizasyon** — board değişiklikleri Socket.io üzerinden canlı yayılır
- **İngilizce ve Türkçe** — workspace başına değil, kullanıcı başına bir tercih; böylece tek bir
  workspace farklı diller okuyan insanları bir arada tutabilir. Giriş yaptığınız her cihaza
  gelir, oluşturduğunuz board'un başladığı column adlarını belirler ve size gönderilen e-postanın
  dilini seçer. Bir katalogda olup diğerinde olmayan bir key build'i düşürür
  ([ADR 0018](docs/tr/decisions/0018-localization-strategy.md))

## Hızlı başlangıç

İki yol var ve hangisini istediğiniz Kurul'u **çalıştırmak** mı yoksa üzerinde **geliştirme
yapmak** mı istediğinize bağlı. İkisi de bir clone ve bir `.env` ile başlar; yalnızca ikincisi
bir toolchain ister.

### Çalıştırmak

Tek ön koşul Docker Compose v2 — Node yok, pnpm yok, lokal build yok.

```bash
git clone https://github.com/dravcore/kurul.git
cd kurul
cp .env.example .env   # POSTGRES_PASSWORD ayarla (openssl rand -hex 32), BETTER_AUTH_SECRET ayarla (openssl rand -hex 32)
docker compose pull && docker compose up -d
```

Ardından **http://localhost** adresini açın — `localhost:3000` değil. Pakete dahil Caddy
reverse proxy'si stack'in tek yayınlanmış girişidir ve her iki uygulamayı tek origin'den
sunar; `api` ve `web` kendi host portlarını yayınlamaz. İkisini tek origin'den sunduğu için
**aynı yayınlanmış imaj her domain'de yeniden build edilmeden çalışır** — kendi domain'inize
taşımak için `.env`'de `SITE_URL=https://kurul.example.com` ayarlamanız yeterli, bu aynı
zamanda otomatik HTTPS'i de açar. SMTP dahil tek sayfalık rehber:
[docs/tr/self-hosting.md](docs/tr/self-hosting.md).

Her etiketli release, servis imajlarını GHCR'a yayınlar (`ghcr.io/dravcore/kurul-api`,
`ghcr.io/dravcore/kurul-web` ve — v0.2.0'dan sonraki ilk sürümden itibaren — tek seferlik
`ghcr.io/dravcore/kurul-migrate`) — bu sayede kurulum ve upgrade lokal build gerektirmez;
`latest` yerine belirli bir sürümü sabitlemek için `.env`'de `TAG=vX.Y.Z` ayarlayın. `TAG`'iniz için
henüz yayınlanmış bir imaj yoksa (veya `ghcr.io`'ya ağ erişimi yoksa) `docker compose up -d`
otomatik olarak kaynaktan build'e döner — `docker compose up --build` de bilinçli olarak build
etmek isteyenler için aynen çalışmaya devam eder.

### Geliştirmek

| Araç           | Sürüm    | Not                                                                |
| -------------- | -------- | ------------------------------------------------------------------ |
| Node.js        | **≥ 24** | `engines` tabanı. Desteklenen hat 24 LTS                           |
| pnpm           | 9+       | `corepack enable && corepack prepare pnpm@latest --activate`       |
| Docker Compose | v2       | Plugin biçimi (`docker compose`); v1 `docker-compose` desteklenmez |
| Git            | 2.30+    |                                                                    |

Lokal PostgreSQL veya Redis kurulumuna gerek yok — ikisi de Docker'da çalışır.

```bash
git clone https://github.com/dravcore/kurul.git
cd kurul
cp .env.example .env   # BETTER_AUTH_SECRET ayarla (openssl rand -hex 32), POSTGRES_PASSWORD ayarla (openssl rand -hex 32)
pnpm install
pnpm bootstrap         # paylaşılan paketler → Prisma client → container'lar → migration → demo veri
pnpm dev
```

- Web: http://localhost:3000
- API health: http://localhost:4000/health
- Mailpit (API'nin gönderdiği her mesaj): http://localhost:8025

`pnpm bootstrap` ([`scripts/bootstrap.mjs`](scripts/bootstrap.mjs)), dev loop'un eskiden
istediği beş komutun ta kendisi — aynı sırayla — artı `.env` üzerinde bir ön kontrol ve
container'ların kendi healthcheck'lerine bir bekleme:

```bash
pnpm -r --filter @kurul/shared-types --filter @kurul/auth-access build
pnpm db:generate
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:seed
```

**Her `git pull` sonrası yeniden koşturun.** Idempotent'tir ve halihazırda workspace tutan bir
veritabanını bilinçli olarak yeniden seed'lemez — `pnpm db:seed` insert'ten önce siler, yani
düzenli koşturmanız söylenen bir betik, üzerinde çalıştığınız board'u sessizce silen bir betik
olmamalıdır. Yine de seed'lemek için `--seed`, o adımı tümüyle atlamak için `--no-seed`.

Betiğin var olma sebebinin büyük kısmı o iki build adımıdır, çünkü ikisinden birinin atlanması
eksik bir adımdan çok bozuk bir checkout gibi okunan hatalar üretir. Paylaşılan paket build'i
olmadan `apps/api` `TS2307: Cannot find module '@kurul/shared-types'` verir ve `pnpm db:seed`
veritabanına hiç ulaşmadan `@kurul/auth-access/dist/cjs/index.js` üzerinde ölür; `pnpm build` ve
`pnpm typecheck` bunu sizin yerinize yapar, `pnpm dev`, `pnpm db:seed` ve `pnpm lint` yapmaz.
Test suite'leri paketlerin `src` dizinini doğrudan okur ve build olmadan da koşar.
`pnpm db:generate` olmadan ise Prisma türevli bir tür import eden hiçbir şey typecheck'ten
geçmez ve build olmaz — client git-ignored'dır ve onu üreten bir `postinstall` hook'u yoktur.
O adımın başkasının migration'larını çektikten sonra da yeniden koşması gerekir:
`pnpm db:migrate` onları uygular ama client'ı yeniden üretmez (_kendi_ şema düzenlemeleriniz
için olan `pnpm db:migrate:dev` ikisini birden yapar).

### Her iki yol için

`POSTGRES_PASSWORD`'ün varsayılanı yoktur — ayarlanmadan compose başlamayı reddeder.
`BETTER_AUTH_SECRET`'ten farklı olarak bu değer doğrudan bir bağlantı URL'ine gömülür,
dolayısıyla `openssl rand -base64 32` burada yanlış üreticidir — alfabesi `/` ve `+` içerir,
ikisi de parolaya düşerse URL'i bozar (`/` authority bölümünü doğrudan sonlandırır; base64-32
çıktılarının kabaca yarısı en az bir tane içerir). Bunun yerine alfabesi (`0-9a-f`) her zaman
URL-güvenli olan `openssl rand -hex 32` kullanın; bkz.
[docs/tr/development.md#veritabanı-ve-cache-kimlik-bilgileri](docs/tr/development.md#veritabanı-ve-cache-kimlik-bilgileri).
Dev loop'ta `.env.example`'da birkaç satır üstündeki `DATABASE_URL`'in şifre kısmı bununla elle
eşleştirilmelidir — o host tarafındaki string, `pnpm dev`'in `localhost:5432`'ye ulaşmak için
kullandığı şeydir ve compose ikisini senkronize tutmaz. `docker compose up` kendi bağlantı
string'ini `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`'den kurar ve o satırı hiç okumaz.

Uygulama SMTP yapılandırılmadan da ayağa kalkar, ama davetler yapılandırılana kadar kabul
edilemez — yukarıdaki dev compose dosyası [Mailpit](https://mailpit.axllent.org/)'i zaten
başlatır, böylece bu akışı gerçek bir mail sağlayıcısı olmadan lokal olarak test edebilirsiniz
(`SMTP_HOST=localhost`, `SMTP_PORT=1025`); bkz.
[docs/tr/development.md#smtp-ve-mailpit](docs/tr/development.md#smtp-ve-mailpit).

Günlük detaylar: [docs/tr/development.md](docs/tr/development.md).

## Stack

| Katman            | Seçim                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Backend           | NestJS 11 + Prisma 7 + PostgreSQL 18 + Redis 8 + Socket.io                     |
| Frontend          | Next.js 16 (App Router) + Tailwind CSS + shadcn/ui + @dnd-kit + Recharts       |
| Auth              | Better Auth (organization plugin → Workspace)                                  |
| E-posta           | SMTP üzerinden `nodemailer` (davet doğrulaması)                                |
| Paylaşılan tipler | `packages/shared-types` + `packages/auth-access` (DTO'lar / BA org AC rolleri) |
| Deployment        | Docker Compose                                                                 |
| Mimari            | Monorepo, modüler monolit — mikroservis yok                                    |

Her seçimin tam gerekçesi: [docs/tr/tech-stack.md](docs/tr/tech-stack.md) ve
[docs/tr/decisions/](docs/tr/decisions/).

## Dokümantasyon

Beş dakikalık harita (EN kanonik): **[docs/README.md](docs/README.md)**. Türkçe harita:
**[docs/tr/README.md](docs/tr/README.md)**.

| Doküman                                                  | Kapsam                           |
| -------------------------------------------------------- | -------------------------------- |
| [docs/tr/architecture.md](docs/tr/architecture.md)       | Modül haritası, veri modeli      |
| [docs/tr/design.md](docs/tr/design.md)                   | UI/UX dili                       |
| [docs/tr/development.md](docs/tr/development.md)         | Yerel kurulum ve günlük komutlar |
| [docs/tr/api-conventions.md](docs/tr/api-conventions.md) | REST, hatalar, pagination        |
| [ROADMAP.md](ROADMAP.md) (İngilizce)                     | MVP bitti; Beyond MVP listesi    |
| [docs/tr/decisions/](docs/tr/decisions/)                 | ADR’ler                          |

## Katkıda bulunma

Hata bildirimleri, özellik fikirleri ve pull request'ler hoş karşılanıyor: kod, doküman ve
çeviri, hepsi. Kurul issue-first çalışıyor; önemsiz olmayan bir işe başlamadan önce bir issue
açın ya da mevcut olanı bulun ve onaylanmasını bekleyin. Süreç için
[CONTRIBUTING.md](CONTRIBUTING.md)'ye (İngilizce), birlikte nasıl çalıştığımız için ise
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)'ye bakın.

## Topluluk

**Resmî kanal [GitHub Discussions](https://github.com/dravcore/kurul/discussions).**
Trafiği üç kategori taşıyor:

| Kategori                                                                                | Ne için                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Q&A](https://github.com/dravcore/kurul/discussions/categories/q-a)                     | Kurulum, self-hosting ve kullanım soruları — hata bildirimi olmayan her şey                                                                          |
| [Ideas](https://github.com/dravcore/kurul/discussions/categories/ideas)                 | Yol haritası geri bildirimi. Her [MVP ötesi](ROADMAP.md#beyond-mvp) satırının burada bir discussion'ı var — istediğinizi oylayın ya da yenisini açın |
| [Show and tell](https://github.com/dravcore/kurul/discussions/categories/show-and-tell) | Onunla ne kurduğunuz ve board'unuzun neye benzediği                                                                                                  |

Tekrarlanabilir hatalar yine [issue](https://github.com/dravcore/kurul/issues), güvenlik
açıkları ise ikisi yerine [SECURITY.md](SECURITY.md).

## Güvenlik

Bir güvenlik açığı bildirmek için [SECURITY.md](SECURITY.md)'ye bakın.

## Lisans

[AGPL-3.0](LICENSE) — kod tabanının tamamı, tek katman, hiçbir şey saklı değil.

Kurul'u kendi sunucunuzda çalıştırmak sonsuza kadar ücretsiz. Kendi kurduğunuz bir instance'tan
hiçbir şey esirgenmiyor, open core yok, ayrıca satılan bir sürüm de yok. Dravcore'un para
istediği tek şey isteğe bağlı bir barındırma servisi: bizim sunucularımızda bir hesap,
yayınlanmış limitlerin (koltuk, board, depolama) içinde ücretsiz, üzerinde ücretli. O servis de
bu depodaki aynı AGPL-3.0 kodunu çalıştırıyor, plan limitleri ve faturalama dahil; yani kendi
instance'ını çalıştıran herkes o limitleri kendi belirleyebilir ya da tümüyle kapatabilir
([ADR 0028](docs/tr/decisions/0028-open-contributions-hosted-service.md)).
