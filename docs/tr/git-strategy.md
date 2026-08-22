# Git Stratejisi

Kurul için branch modeli, commit convention'ı, PR süreci ve release prosedürü.

> 🌐 [English (canonical)](../git-strategy.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## İçindekiler

- [Branch modeli](#branch-modeli)
- [Branch adlandırma](#branch-adlandırma)
- [Conventional Commits](#conventional-commits)
- [Pull request süreci](#pull-request-süreci)
- [Release süreci](#release-süreci)
- [Hotfix süreci](#hotfix-süreci)
- [Versiyonlama politikası (SemVer)](#versiyonlama-politikası-semver)
- [Kurallar özeti](#kurallar-özeti)

## Branch modeli

Kurul **Git Flow** kullanır. İki branch kalıcıdır; geri kalan her şey kısa ömürlüdür ve
merge sonrası silinir.

| Branch      | Ömür        | Şuradan dallanır | Şuraya merge olur  | Amaç                                                                        |
| ----------- | ----------- | ---------------- | ------------------ | --------------------------------------------------------------------------- |
| `main`      | kalıcı      | —                | —                  | Yalnızca release edilmiş kod. Her commit etiketli (tagged) bir release'tir. |
| `develop`   | kalıcı      | `main`           | —                  | Entegrasyon branch'i. Her zaman ayağa kalkar (aşağıya bakın).               |
| `feature/*` | kısa ömürlü | `develop`        | `develop`          | Yeni işlevsellik                                                            |
| `fix/*`     | kısa ömürlü | `develop`        | `develop`          | Acil olmayan bug fix'leri                                                   |
| `docs/*`    | kısa ömürlü | `develop`        | `develop`          | Yalnızca dokümantasyon değişiklikleri                                       |
| `chore/*`   | kısa ömürlü | `develop`        | `develop`          | Tooling, dependency'ler, config, CI                                         |
| `release/*` | kısa ömürlü | `develop`        | `main` + `develop` | Versiyon bump'ı, changelog finalizasyonu, release sertleştirmesi            |
| `hotfix/*`  | kısa ömürlü | `main`           | `main` + `develop` | Acil production fix'i                                                       |

```
main     ──●───────────────────────●──────────────●──  tags: v0.1.0, v0.1.1, v0.2.0
            \                     /              /
release      \              ●────●              /      release/0.2.0
              \            /                   /
develop  ──────●──●──●────●───────●──●──●─────●─────
                  /        \         /  /
feature          ●          └─ geri-merge

```

**Staging ortamı yok.** Bu tablo eskiden `develop`'ın "her zaman staging'e deploy
edilebilir" olduğunu söylüyordu; böyle bir dağıtım hiç var olmadı — bu depoda onu gösteren bir
host, bir workflow veya bir secret yok (denetim bulgusu OPS-08). Hiçbir şeyin zorlamadığı
duran bir iddia, iddiasızlıktan kötüdür; işte gerçekten kontrol edilen iddia: `develop`
**ayağa kalkmalı** ve kontrolü herkesin kendi makinesinde çalıştırabileceği bir komut.

```bash
docker compose up -d --build
docker compose ps -a                              # her servis ayakta; migrate Exited (0)
curl -s http://localhost/api/health/ready         # {"status":"ok","checks":{…}}
```

Bu, `SITE_URL` varsayılan `http://localhost` değerinde bırakılmış haliyle bir self-host
kullanıcısının çalıştırdığı stack'in ta kendisidir ([Self-hosting](self-hosting.md)); yani
"ayağa kalkıyor", staging'e özgü bir yaklaşıklık üzerinde değil gerçek dağıtım biçimi üzerinde
doğrulanır. CI bunu çalıştırmaz — pipeline build, lint, tip ve test yapar ve her pull request'te
tam bir compose açılışı, yakaladığından fazlasına mal olur — bu da onu release zamanına ait bir
adım yapar; [release sürecinin 4. adımıdır](#release-süreci).

**`main` veya `develop`'a doğrudan commit yok.** Tüm iş onlara bir branch ve bir pull
request üzerinden ulaşır. Bu maintainer'lar için de geçerlidir.

`main` yalnızca release'lerdir: `main` üzerinde bir commit varsa ve bu `release/*` veya
`hotfix/*`'ten bir merge değilse, bir şeyler ters gitmiştir.

`main` ve `develop` üzerindeki branch protection bunu zorunlu kılar: doğrudan push yok,
pull request zorunlu. Zorunlu status check'ler [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) ile uygulanır.

### Dependabot ve `main`

Dependabot `main`'e değil, `develop`'a açmalıdır. Her iki ekosistem
[`.github/dependabot.yml`](../../.github/dependabot.yml) içinde bu yüzden
`target-branch: develop` ayarlıdır. Bağımlılık bump'larını doğrudan `main`'e merge etmek
([#82](https://github.com/dravcore/kurul/pull/82)'de olduğu gibi) Git Flow'u atlar ve
`develop`'ı CI config'te geride bırakır — tekrarlanmamalı. Bir Dependabot PR bir şekilde
`main`'i hedefliyorsa, merge'den önce `develop`'a retarget edin.

## Branch adlandırma

Format: `type/kebab-kısa-açıklama`

- `type`, `feature`, `fix`, `docs`, `chore`, `release`, `hotfix`'ten biridir
- Açıklama küçük harf kebab-case, 2–5 kelime, bir faz numarası, ticket alias'ı veya adınız
  değil, **değişikliği** tarif eder
- `release/*` ve `hotfix/*`, bir açıklama yerine versiyonu taşır: `release/0.2.0`

| İyi                           | Kötü               | Neden                                                  |
| ----------------------------- | ------------------ | ------------------------------------------------------ |
| `feature/board-drag-and-drop` | `feature/phase3`   | Faz numaraları değişiklik hakkında hiçbir şey söylemez |
| `fix/task-position-collision` | `fix/bug`          | Bir branch listesinde tanımlanamaz                     |
| `docs/api-conventions`        | `docs/update-docs` | Gereksiz, bilgi yok                                    |
| `chore/bump-prisma-7`         | `dogan-work`       | Type öneki yok, taranabilir değil                      |
| `release/0.2.0`               | `release/v0.2.0`   | `v` öneki tag'lere aittir, branch'lere değil           |

Commit type'ları ve branch type'ları kasıtlı olarak aynı kelime dağarcığını paylaşır —
`feat:` ağırlıklı bir branch, bir `feature/*` branch'idir.

## Conventional Commits

Tüm commit mesajları **İngilizce** yazılır ve
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)'ı takip eder.

```
<type>(<scope>): <subject>

<body — opsiyonel, 72–80 karakterde sarılır, NEDEN'i açıklar>

<footer — opsiyonel: BREAKING CHANGE:, Closes #123>
```

### Type'lar

| Type       | Ne için kullanılır                                              | SemVer etkisi (1.0 sonrası) |
| ---------- | --------------------------------------------------------------- | --------------------------- |
| `feat`     | Kullanıcının göreceği yeni bir yetenek                          | MINOR                       |
| `fix`      | Bir bug fix'i                                                   | PATCH                       |
| `docs`     | Yalnızca dokümantasyon                                          | yok                         |
| `chore`    | Tooling, dependency'ler, config, repo temizliği                 | yok                         |
| `refactor` | Ne bir bug'ı düzelten ne de bir özellik ekleyen kod değişikliği | yok                         |
| `test`     | Test ekleme veya düzeltme                                       | yok                         |
| `ci`       | CI/CD pipeline ve workflow değişiklikleri                       | yok                         |
| `perf`     | Davranış değişikliği olmadan performans iyileştirmesi           | PATCH                       |

`BREAKING CHANGE:` footer'ı olan (veya `type!:`) bir commit, 1.0 sonrası MAJOR'dır. Bunun
1.0 öncesi ne anlama geldiği için [Versiyonlama politikası](#versiyonlama-politikası-semver)
bölümüne bakın.

### Scope'lar

Scope opsiyoneldir ama kuvvetle tercih edilir. Monorepo'nun etkilenen kısmını adlandırır.

| Scope         | Anlam                                                        |
| ------------- | ------------------------------------------------------------ |
| `api`         | `apps/api` — NestJS backend                                  |
| `web`         | `apps/web` — Next.js frontend                                |
| `shared`      | `packages/shared-types`                                      |
| `auth-access` | `packages/auth-access` — Better Auth organization AC rolleri |
| `deps`        | Dependency bump'ları                                         |
| `docs`        | `docs/` seti (commit type'ı zaten `docs` değilse)            |
| `ci`          | Workflow'lar ve pipeline config'i                            |

Daha dar modül scope'ları netlik kattığında sorun değildir: `feat(api/task)`,
`fix(web/board)`.

### Subject satırı

- Emir kipi: "add", "added" veya "adds" değil
- Sonda nokta yok, iki noktadan sonra küçük harf
- 72 karakterin altında

### Örnekler

```
feat(api): add cursor pagination to task list endpoint

fix(web): keep card order stable when two users drag simultaneously

Positions were recalculated from the stale local list, so a concurrent
move produced two identical Float positions. The move mutation now sends
the neighbour ids and lets the server compute the midpoint.

Closes #142

docs: document the release process in git-strategy

chore(deps): bump prisma to 7.2.1

feat(api)!: scope board endpoints under /workspaces/:workspaceId

BREAKING CHANGE: /boards/:id is removed. Clients must use
/workspaces/:workspaceId/boards/:id.
```

**Sıradan olmayan commit'ler için body yazın.** Subject satırı neyin değiştiğini söyler;
body ise önceden neden yanlış olduğunu söyler. Commit'ler, aylar sonra o bağlamı olmayan
insanlar tarafından okunur.

## Pull request süreci

1. Güncel bir `develop`'tan dallanın.
2. PR'ı **`develop`'a karşı** açın (`hotfix/*` ve `release/*` dışında, asla `main`'e karşı
   değil).
3. PR başlığı Conventional Commits'i takip eder. Branch'teki commit'lerin history'de
   kalması için merge commit (`--no-ff`) tercih edin; PR açmadan önce onları temiz tutun.
   `develop`'a squash, gürültü (Dependabot, tek-commit chore) için serbesttir. `main`'e
   squash asla serbest değildir — aşağıdaki Merge stratejisine bakın.
4. PR'ları küçük ve tek sorumluluklu tutun: bir konu, tercihen lockfile'lar ve üretilen
   çıktı hariç ~500 değişen satırın altında. Mümkün olduğunda şema değişikliklerini logic
   değişikliklerinden, backend'i frontend'den ayırın.
5. PR'ın çözdüğü issue'yu linkleyin (`Closes #123`).
6. CI yeşil olmalıdır: lint, typecheck, testler (bkz. [testing.md](testing.md)).
7. Merge öncesi en az bir onaylayıcı review.

**Solo-maintainer istisnası.** Proje tek bir maintainer'a sahipken kural 7'yi
memnun edecek kimse yok, dolayısıyla maintainer'ın açtığı PR'lar için askıya
alınır: bunlar CI yeşile döndüğünde kendi kendine review edilir ve kendi kendine
merge edilir. Geri kalan her şey hâlâ geçerli — branch, PR, Conventional Commits
başlığı, yeşil pipeline. Katkıda bulunanların PR'ları maintainer tarafından her
zamanki gibi review edilir. **Tek-onay-review kuralı ikinci bir maintainer var
olduğu anda tekrar devreye girer** ve bu paragraf o zaman silinir.

### Merge stratejisi

| Merge                                                 | Strateji                                                                         | Sebep                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `feature/*`, `fix/*`, `docs/*`, `chore/*` → `develop` | **Merge commit** tercih; Dependabot / tek-commit gürültü için **squash serbest** | Anlamlı çok-commit history korunur; bot gürültüsü squash ile ezilir |
| `release/*` → `main`                                  | **Yalnızca merge commit** (`--no-ff`)                                            | Release'i history'de ayrı, geri alınabilir bir nokta olarak korur   |
| `hotfix/*` → `main`                                   | **Yalnızca merge commit** (`--no-ff`)                                            | Aynı sebep                                                          |
| `main` → `develop` (geri-merge)                       | **Merge commit** (`--no-ff`)                                                     | Release/hotfix commit'lerini yeniden yazmadan geri taşır            |

`main`'e squash ve rebase yasaktır. `main` üzerindeki bir repository ruleset, izin verilen
merge yöntemlerini merge commit ile sınırlar; böylece bir release/hotfix yanlışlıkla
düzleştirilemez. `develop`'a squash Dependabot ve diğer tek-commit branch'ler için açık;
insanların çok-commit işi hâlâ merge commit tercih eder. Fixup gürültüsünü PR açmadan
**önce** branch üzerinde temizleyin (interactive rebase veya amend).

Merge sonrası branch'i silin. GitHub'ın "delete branch on merge" ayarı bunu hallediyor.

## Release süreci

Release'ler `develop`'tan bir `release/*` branch'i üzerinden kesilir. Versiyonlar
[SemVer](https://semver.org/)'ı, changelog ise
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)'ı takip eder.

```bash
# 1. develop'tan dallan
git switch develop && git pull
git switch -c release/0.2.0

# 2. Her package.json'da versiyonu bump'la (kök, apps/*, packages/*)
#    ve CHANGELOG.md'yi finalize et: [Unreleased]'i [0.2.0] - YYYY-MM-DD olarak yeniden adlandır,
#    en üste yeni bir boş [Unreleased] bölümü ekle.
git commit -am "chore(release): 0.2.0"

# 3. Bu branch'e yalnızca release'i engelleyen fix'ler girebilir.
#    Geri kalan her şey her zamanki gibi develop'a gitmeye devam eder.

# 4. Bu branch'ten stack'i bir kez ayağa kaldır, sonra bir PR aç:
#    release/0.2.0 -> main. Bir merge commit ile (--no-ff) merge et.
#
#    CI hiçbir şeyi ayağa kaldırmaz: kodu build eder, lint'ler, tiplerini ve
#    testlerini kontrol eder — bunların hiçbiri artık başlamayan bir
#    docker-compose.yml veya Caddyfile'ı fark etmez. Branch tablosundaki
#    "her zaman ayağa kalkar" iddiasının arkasındaki kontrol budur ve bozuk
#    olanı düzeltmenin hâlâ ucuz olduğu son nokta burasıdır.
docker compose up -d --build
docker compose ps -a                       # -a olmazsa tek seferlik migrate satırı gizlenir
curl -s http://localhost/api/health/ready  # {"status":"ok","checks":{…}}
docker compose down -v                     # -v: sonraki koşuya volume bırakma

# 5. main üzerindeki merge commit'ini tag'le. Container imajlarını yayınlayan şey
#    de budur (.github/workflows/release-images.yml) — tag yoksa imaj da yok ve
#    docs/self-hosting.md'yi izleyen herkes için `docker compose pull` başarısız olur.
#    Aynı koşu üç imajın tamamını cosign ile imzalar ve SBOM'larını üretir.
#
#    Belirli bir imaj *adı* GHCR'a ilk kez push edildiğinde, oluşturduğu paket
#    varsayılan olarak PRIVATE'tır — repo'nun kendi görünürlüğünden bağımsız
#    olarak — ve anonim bir `docker compose pull` bu pakete karşı "denied"
#    hatasıyla başarısız olur; tam olarak denetim bulgusu OPS-01'deki
#    semptom. Bunun için API yoktur: release'i duyurmadan önce, bir kez, elle
#    organizasyonun paket ayarlarından Public'e çevirin (org -> Packages ->
#    yeni imaj -> Package settings -> Change visibility). `kurul-migrate`
#    bunu v0.2.0'dan sonraki ilk release'de gerektirir — bu workflow'un onu
#    ilk yayınladığı release — ve sonradan eklenen her yeni imaj adı da aynı
#    şekilde, bir kez, buna ihtiyaç duyar.
git switch main && git pull
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0

# 6. Release images workflow'unun bitmesini bekle, sonra v0.2.0 tag'i için GitHub
#    Release'i yayınla, body = 0.2.0 için CHANGELOG bölümü.
#
#    Workflow oraya önce varır ve altı SBOM asset'i (3 imaj × 2 platform)
#    çoktan eklenmiş bir TASLAK release bırakır — yani 6. adım normalde
#    "release oluştur" değil, "body'yi doldur ve Publish'e bas" olur.
#    Workflow bitmeden elle yayınlamak da hata
#    değildir: o durumda asset'ler bulduğu release'e yüklenir, body'ye, başlığa
#    ve taslak bayrağına hiç dokunulmaz. Yine de beklemek daha doğru sıradır —
#    asset'ler bir release'in parçasıdır.

# 7. Versiyon bump'ının ve herhangi bir release-branch fix'inin kaybolmaması için
#    main'i develop'a geri-merge et.
git switch develop && git pull
git merge --no-ff main
git push origin develop

# 8. release/0.2.0'ı sil.
```

| Artifact                     | Format                    | Örnek                     |
| ---------------------------- | ------------------------- | ------------------------- |
| Branch                       | `release/x.y.z`           | `release/0.2.0`           |
| `package.json`'daki versiyon | `x.y.z`                   | `0.2.0`                   |
| Git tag'i                    | `vX.Y.Z`                  | `v0.2.0`                  |
| Changelog başlığı            | `## [x.y.z] - YYYY-MM-DD` | `## [0.2.0] - 2026-09-14` |

`CHANGELOG.md`, release zamanında git log'undan yeniden kurulmak yerine sürekli olarak
`[Unreleased]` altında bakımı yapılır. Bir PR kullanıcı tarafından görülebilirse,
changelog'u günceller.

### Geri-merge'de CHANGELOG çakışmaları

Her release'de ve her hotfix'te bir tane bekleyin. `develop`, `[Unreleased]` girdilerini
biriktirmeye devam ederken `release/*` branch'i kendi `[Unreleased]`'ini bir versiyon
başlığına yeniden adlandırıyor, dolayısıyla dosyanın iki versiyonu tam olarak aynı
satırlarda ayrışıyor ve `git merge --no-ff main` dosyanın en üstünde çakışıyor. Bu normal,
bir şeylerin ters gittiğinin işareti değil.

Bunu çözen kural:

- **`CHANGELOG.md` yalnızca `release/*` ve `hotfix/*` branch'lerinde finalize edilir.**
  `[Unreleased]`'i `## [x.y.z] - YYYY-MM-DD`'ye yeniden adlandırmak orada olur, başka hiçbir
  yerde değil.
- **Geri-merge'de, versiyon başlıkları için release tarafını alın**, sonra release branch'i
  açıkken `develop`'a inen tüm `[Unreleased]` girdilerini, en üstteki taze ve boş bir
  `[Unreleased]`'in altına yeniden ekleyin. Sonuç: önce `[Unreleased]`, altında yeni versiyon
  bölümü, onun altında daha eski versiyonlar.
- Bu çözümde hiçbir şey silinmez. Bir girdi merge'den önce iki taraftan birinde varsa,
  merge'den sonra da vardır.

`git config rerere.enabled true`'yu bir kez ayarlamaya değer — çözüm yapısal olarak her
release'de aynı, ve rerere ilk seferden sonra bunu otomatik olarak tekrarlıyor.

### Yayın yolunu prova etmek

`release-images.yml` bir ön-sürüm tag'inde de (`vX.Y.Z-rc.N`, `-beta.N`, tirenin ardından ne
gelirse) tetiklenir ve bunun tek bir sebebi vardır: workflow imaj yayınlar, cosign ile imzalar
ve SBOM ekler — bunların **hiçbiri CI'da koşmaz**. Hiç çalışmamış bir workflow'un ilk koşusunu
gerçek bir sürüm yapmak, sürümün kendisini teste dönüştürür.

Dolayısıyla yayın yolu değiştiyse — yeni bir action major'ı, imzalama veya SBOM adımlarında bir
değişiklik, yeni bir registry — 5. adımdan önce prova edin:

```bash
git tag -a v0.2.0-rc.1 -m "v0.2.0-rc.1"
git push origin v0.2.0-rc.1
```

Prova gerçek bir yayındır: gerçek imajlar, gerçek imza, gerçek SBOM asset'leri, ve
[self-hosting.md](self-hosting.md#çektiğiniz-imajı-doğrulamak)'daki `cosign verify` komutu
ona karşı çalışır. Bilinçli olarak **yapmadığı** şey, birilerinin takip ettiği bir şeyi
oynatmaktır: ön-sürümde `{{major}}.{{minor}}` ve `latest` atlanır, yani `TAG` ayarlamamış bir
operatör etkilenmez; GitHub Release'i de hem draft hem ön-sürüm olarak işaretlenir.

Provanın **kapsayamadığı** bir şey var ve `v0.2.0-rc.3`'te ölçüldü: `metadata-action` ön-sürümde
yalnız çıplak `{{version}}` tag'ini üretiyor, yani `0.2.0-rc.3` yayınlanıyor, `v0.2.0-rc.3`
yayınlanmıyor. `v` önekli tag — bu repodaki her pull komutunun operatöre pinlemesini söylediği
biçim — dolayısıyla ancak gerçek bir sürümle sınanıyor. Merge job'ı, ön-sürüm olmayan her tag'de
o biçimin üretildiğini doğruluyor; yani bir gerileme, 404 veren belgelenmiş bir komut yayınlamak
yerine sürümü kırar. Ama bu doğrulama da ilk kez sürümü kestiğinizde koşar.

Prova tag'i tek kullanımlıktır. Gerçek sürüm çıkınca tag'i ve release'ini silin; imajlar kendi
`-rc` tag'leriyle registry'de kalır ve paket listesinde bir satırdan başka maliyeti olmaz.

## Hotfix süreci

Bir sonraki release'i bekleyemeyecek, release edilmiş bir versiyondaki bir bug için.

```bash
git switch main && git pull
git switch -c hotfix/0.2.1
# düzelt, sonra patch versiyonunu bump'la + CHANGELOG girdisini ekle
git commit -am "fix(api): reject task move across workspaces"
git commit -am "chore(release): 0.2.1"
# PR hotfix/0.2.1 -> main, --no-ff ile merge et, v0.2.1 tag'le, release'i yayınla
# sonra main -> develop geri-merge et
```

Geri-merge opsiyonel değildir. `develop`'a hiç ulaşmayan bir hotfix, bir sonraki release'de
yeniden ortaya çıkar.

## Versiyonlama politikası (SemVer)

Kurul, SemVer'ın garantilerinin 1.0 öncesi daha zayıf olduğu dürüst çekincesiyle
[Semantic Versioning 2.0.0](https://semver.org/)'ı takip eder.

**1.0 öncesi (`0.y.z`) — projenin şu anda bulunduğu yer:**

- Public API (REST endpoint'leri, `@kurul/shared-types`, `@kurul/auth-access`,
  veritabanı şeması, env değişken isimleri) **kararlı değildir**. Breaking değişiklikler
  herhangi bir `0.y.0`'da gelebilir.
- `0.y.0` (MINOR): yeni özellikler **ve** breaking değişiklikler.
- `0.0.z` / `0.y.z` (PATCH): yalnızca bug fix'leri ve breaking olmayan değişiklikler.
- Her breaking değişiklik, bir migration notuyla birlikte `CHANGELOG.md`'de `### Changed`
  veya `### Removed` altında belgelenir. "Kararsız" hiçbir uyumluluk garantisi olmadığı
  anlamına gelir, hiçbir iletişim olmadığı değil.

**1.0 sonrası:**

- MAJOR: REST API'de, shared types'ta bir breaking değişiklik, ya da otomatik
  uygulanamayan bir migration.
- MINOR: geriye uyumlu özellik.
- PATCH: geriye uyumlu fix.

1.0.0, [ROADMAP.md](../../ROADMAP.md)'deki MVP özellik seti tamamlandığında ve REST API uyumluluk
vaat edecek kadar kararlı sayıldığında kesilir.

API versiyonlama duruşu (1.0 öncesi `/v1` öneki yok)
[api-conventions.md](api-conventions.md#versiyonlama)'de ele alınıyor.

## Kurallar özeti

| Kural                                |                                                            |
| ------------------------------------ | ---------------------------------------------------------- |
| `main` / `develop`'a doğrudan commit | Asla                                                       |
| PR hedef branch'i                    | `develop` (`main`'e giden `release/*` ve `hotfix/*` hariç) |
| Commit dili                          | İngilizce                                                  |
| Commit formatı                       | Conventional Commits                                       |
| Feature → `develop`                  | Merge commit tercih; Dependabot/gürültü için squash OK     |
| Release/hotfix → `main`              | Yalnızca merge commit + `develop`'a geri-merge             |
| Tag formatı                          | `vX.Y.Z`                                                   |
| Changelog                            | Release zamanında değil, PR'da güncellenir                 |

## Ayrıca bakınız

- [../CONTRIBUTING.md](../../CONTRIBUTING.md) — bu sürecin katkıda bulunanlara yönelik özeti
- [development.md](development.md) — ortam kurulumu ve günlük döngü
- [coding-standards.md](coding-standards.md) — reviewer'ların bir PR'da kontrol ettikleri
- [testing.md](testing.md) — CI'ın her PR'da çalıştırdığı
- [../../ROADMAP.md](../../ROADMAP.md) — bir release'in içerdiği
- [decisions/0008-git-flow-semver.md](decisions/0008-git-flow-semver.md) — Git Flow ve
  SemVer'ın neden seçildiği
