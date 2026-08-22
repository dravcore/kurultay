# 0022. Dosya Eki Depolaması: Bir Port Arkasında Yerel Disk, API Origin'inden Servis

**Durum:** Kabul edildi
**Tarih:** 2026-08-14

> 🌐 [English (kanonik)](../../decisions/0022-attachment-storage.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

## Bağlam

Kurul insanlara bunu yapamadığını, üstelik nedenini de söyleyerek anlatıyor. `README.md`,
ürünün `v0.1.0`'da olmadığı şeyler arasında "no task attachments" satırını taşıyor ve
[ROADMAP.md — Beyond MVP](../../../ROADMAP.md#beyond-mvp)'ye işaret ediyor; oradaki kayıt
`Task attachments — Needs an object-storage decision (ADR)` diyor.
[tech-stack.md](../tech-stack.md) aynı şeyi öbür taraftan söylüyor: "File attachments are out of
MVP scope. When added, pick an S3-compatible store." Bu doküman ikisinin de beklediği karardır.

Bu işi programa alan denetim, attachments'ı üç table-stakes boşluğunun başına — checklist ve
Trello import'un önüne — en sık istenen eksik özellik olduğu gerekçesiyle koydu. Rakip self-host
panolar bunu temel kabul ediyor. Geçişi değerlendiren bir takım üç soru soruyor: panolarımı
getirebilir miyim, kartlara dosya koyabilir miyim, checklist'lerim var mı. Herhangi birine "hayır"
demek, değerlendirmeyi farklılaştırıcılara hiç sıra gelmeden bitiriyor.

**Depolama sorusu özellikten daha zor.** Attachments, Kurul'un sakladığı **Postgres satırı
olmayan ilk şey** ve bugüne kadar verilen her operasyonel söz bir veritabanı hakkında verildi.
Gecelik yedek tek komut çalıştırıyor, `pg_dump --format=custom`; `backup` servisi kendi script'ini
ve yedek volume'ünü mount ediyor, başka hiçbir şeyi. Prova edilmiş restore'un başarı tanımı
tamamen veritabanı şeklinde — 17 tablonun tamamının, her satır sayısının, 59 indeksin yeniden
üretilmesi. **Yüklenen her dosya kaybolmuşken bir restore provası %100 geçer.**

[ADR 0020](0020-data-retention.md) bu sorunun bir versiyonunu zaten yanıtladı ve hayır dedi:
soğuk depolamaya arşivleme, "an archive would be a file on the same disk that nobody reads and
nobody restores" gerekçesiyle doğrudan reddedildi. Attachments tam olarak o cümlenin yasakladığı
şeyi getiriyor. Bu itiraz dosyaların kullanıcıya görünür olmasıyla karşılanmıyor — kullanıcı
dosyayı okur, ama kimse onu _yedek olarak_ okumaz. Yalnızca kopyanın dump'la aynı prova edilmiş
takvimde okunup restore edilmesiyle karşılanır.

Soruyu bir zevk meselesi değil gerçekten açık kılan şey dağıtım hedefi. Kurul tek makinede
Compose yığını olarak çıkıyor ([ADR 0001](0001-monorepo-modular-monolith.md)) ve hedef kitle beş
dakikalık kurulum sözü verilmiş bir self-hoster. Bir PDF eklemek için MinIO ya da S3 hesabı
şart koşmak, çoğunluğun sözünü zaten object storage çalıştıran azınlık için bozar; `fs`'i
sabitlemek o azınlığı ortada bırakır ve ileride taşınmayı bir yeniden yazıma çevirir.

## Karar

**Depolama, tek uygulaması olan bir porttur.** `StorageBackend`, `write`, `read`, `remove`
metotlarını taşıyan bir interface; yayınlanan tek uygulama `DiskStorageBackend`. Biçim
`MailSender`'ı birebir kopyalıyor — düz bir interface, `@Injectable()` olmayan düz adapter
sınıfları, saf bir `createStorageBackend(config)` factory'si, reset kancası olan süreç-geneli bir
tekil ve modülün dışa açtığı tek şey olarak dar bir `StorageService`. Yetenek biti kimlikten
ayrı, tıpkı `deliversMail`'in `transport`'tan ayrı olması gibi: kod `persistsFiles` üzerinde
dallanır, asla `backend === 'disk'` üzerinde değil.

**Yapılandırma `SMTP_HOST` desenini izler: varlık açar.** `STORAGE_PATH` set ise attachments
çalışır; set değilse özellik kapalıdır ve `StorageConfig.disk` `undefined`'dır — bir bayrak değil,
tip düzeyinde bir durum. `ATTACHMENTS_ENABLED` yoktur. Bu kod tabanı `_ENABLED` boolean'larını
varsayılan-açık kill switch'lere (`CLEANUP_ENABLED`, `RATE_LIMIT_ENABLED`) ve rızaya
(`TELEMETRY_ENABLED`) ayırıyor; çalışmak için zaten bir değere ihtiyaç duyan varsayılan-kapalı bir
özellik böyle bir bayrak almaz. `GET /config`, web'in kontrolü gösterip göstermeyeceğini bilmesi
için `attachmentsEnabled` kazanır.

**S3 ertelendi, reddedilmedi.** `StorageBackend`, `S3StorageBackend` bir yeniden düzenleme değil
eklenen bir dosya olacak şekilde tasarlandı ve SDK geldiğinde `await import()` ile yüklenecek —
`smtp-mail-sender.ts`'in nodemailer'ı tembel yüklemesinin gerekçesi ~10 MB'lık AWS SDK için daha
da güçlü. **Tetikleyici:** yerel diskin kalıcı olmadığı bir dağıtıma dair ilk operatör bildirimi
(geçici depolamalı bir konteyner host'u ya da çok replikalı bir kurulum). **Tetiklendiğinde
maliyet:** bir adapter dosyası, bir config dalı, bir tembel import — uçlarda, modelde ya da
portta değişiklik değil.

**Yedek ikinci bir iş kazanır.** Attachments volume'ü `backup` servisine salt-okunur mount edilir
ve aynı koşuda dump'ın yanına arşivlenir, aynı `BACKUP_KEEP` takvimiyle budanır. Restore
prosedürü eşleşen bir adım, provanın başarı ölçütü de bir dosya sayısı kazanır. Bu olmadan
`ADR 0020`'nin gerekçesi genişletilmiş değil, çelişilmiş olur.

**Yetim dosyalar süpürülür; grace period restore edilebilir en eski dump'tan kısa olamaz.**
`Workspace → Board → Task` zinciri baştan sona `Cascade`, yani tek bir `DELETE FROM "Workspace"`
hiçbir uygulama kodu devreye girmeden Postgres içinde binlerce attachment satırını siler. Dosya
silme, silme yolunun bir yan etkisi olamaz; yetim üretimi toplu ve sessizdir. Süpürme mevcut
gecelik `cleanup.worker`'a katılır, `CleanupCounts`'a raporlar ve `ADR 0020`'nin loglama kuralı
gereği yalnız sayı yazar — asla yol. Yalnızca mtime'ı `BACKUP_KEEP × BACKUP_INTERVAL`'dan eski
dosyaları dikkate alır.

**Dosyalar API origin'inden, `/api/*` altından ve her istekte yetkilendirmeyle servis edilir.**
Proxy sözleşmesi `/auth/*`'ı Better Auth'a ayırdığı için bir attachment ucu eleme yoluyla `/api/*`
altında yaşar — ki bu aynı zamanda origin'in güvenli yarısıdır. Uçlar kaynak adlandırma kuralını
izler: koleksiyon task'ının altına yuvalanır, tekil kaynak sığ adreslenir ve indirmeye bir aksiyon
segmenti düşer.

```
GET    /workspaces/:workspaceId/tasks/:taskId/attachments
POST   /workspaces/:workspaceId/tasks/:taskId/attachments
GET    /workspaces/:workspaceId/attachments/:attachmentId
GET    /workspaces/:workspaceId/attachments/:attachmentId/content
DELETE /workspaces/:workspaceId/attachments/:attachmentId
```

**İmzalı URL'ler ertelendi.** **Tetikleyici:** dış paylaşım linki, giden e-postaya gömülü bir
görsel ya da proxy'nin önünde bir CDN — hangisi önce gelirse. **Tetiklendiğinde maliyet:** ikinci,
ayrı bir uç ve iptal için Redis tabanlı bir deny-list — bu ucun değişmesi değil.

**Her kontrol geçmeden yanıta hiçbir şey yazılmaz.** Yetkilendirme, varlık ve boyut kontrolleri
ilk byte'tan önce tamamlanır. Stream başladıktan sonra bir hata, yanıtı `res.destroy()` ile
sonlandırır ve `AllExceptionsFilter`'a hiç ulaşmaz.

**Doğrulama bir allowlist artı içerik sniffing'idir ve ret 415'tir.** Beyan edilen `Content-Type`
da uzantı da çağırandan gelir ve hiçbiri kanıt değildir; `file-type` magic byte'ları okur. Retler
`UnsupportedMediaTypeException` fırlatır.

**Boyut limiti iki katmanda kurulur.** API'de multer'ın `limits.fileSize`'ı ve yayınlanan proxy
sözleşmesine eklenen bir gövde-boyutu satırı. `POST`, `ThrottleInvitations()` örnek alınarak bir
`ThrottleUploads()` dekoratörü alır; indirme ucu 100/dk varsayılanından **daha yüksek** bir limit
alır.

**Satır içi önizleme yalnız görselleri kapsar.** Web origin'indeki `frame-src 'none'` ve
`object-src 'none'`, API'deki `frame-ancestors 'none'` ve `X-Frame-Options: DENY` ile birlikte,
her iki tarafta da politika gevşetmeden modal içi bir doküman görüntüleyiciyi imkânsız kılıyor.
**Tetikleyici:** doküman önizlemesi için ölçülmüş bir talep; maliyeti kapsamı daraltılmış bir CSP
gevşetmesi, ayrıca tartışılır.

## Gerekçe

**Neden API origin'i, web origin'i değil.** Web uygulamasının CSP'si `script-src 'self'
'unsafe-inline'` taşıyor, yani o origin'deki bir markup enjeksiyonu zaten inline script
çalıştırabiliyor; oraya saldırgan kontrollü içerik eklemek mevcut bir zaafiyeti büyütür. API'nin
CSP'si `default-src 'none'`, yani oradan doküman olarak açılan kullanıcı yüklemesi bir HTML dosyası
hiçbir şey yükleyemez. `security-headers.ts` bu vektörü `X-Content-Type-Options` üstündeki yorumda
tam olarak adlandırıyor — "a user-uploaded file served as `text/plain` that a browser decides to
render as HTML". Attachment yanıtları ayrıca `Cross-Origin-Resource-Policy: same-origin` alır ve
API'nin global olarak koyduğu `cross-origin` politikasını geçersiz kılar; çünkü origin dışından
hiçbir şeyin bunları gömüyor olmaması gerekir.

**Neden imzalı URL değil de her istekte yetkilendirme.** İmzalı bir URL burada yetkilendirmeyi
proxy'ye taşıyamaz. Caddy kasıtlı olarak aptaldır — üç `handle` kuralı, `admin off`, hiç auth
direktifi yok — ve [self-hosting.md](../self-hosting.md) operatöre onu nginx ya da Traefik ile
değiştirebileceğini vaat ediyor. İmza doğrulaması yine de API içinde koşacaktır, dolayısıyla
imzalı bir URL'in kazandırdığı tek şey guard zincirini atlamaktır — ve bu kod tabanı tenant
izolasyonunu tam olarak orada tutuyor. Atlamanın bedeli somuttur: `@Public()`, `request.user`'ı
set edilmemiş bırakır, bu da `WorkspaceGuard`'ın üyeliği kontrol edemeden fırlamasına yol açar,
dolayısıyla `@WorkspaceScoped()` kullanılamaz hale gelir ve tenant kontrolü
`workspaceMember.findUnique`'in el yazımı bir kopyasına dönüşür — attachment varlığının
sızmasını engelleyen 404-yerine-403 kuralı dahil. Ayrıca iptal mekanizması yoktur: çıkarılmış bir
üyenin oturumu 60 saniyelik cookie cache'i içinde çalışmayı bırakır, oysa dağıtılmış bir imzalı
URL TTL'i dolana kadar geçerli kalır. Yayınlanan imajın topolojisinde — tek origin, `/api` yolu,
`SameSite=Lax` — çerezler `<img src="/api/…">` ve `<a download>` ile birlikte gider, yani imzalı
URL'in var olma sebebi olan avantaj zaten gereksizdir.

**Stream etrafındaki sıralama kuralı neden.** `AllExceptionsFilter` koşulsuz bir
`response.status(statusCode).json(problem)` ile biter ve API'nin hiçbir yerinde ikinci bir hata
formatı yoktur. Bir handler `Content-Disposition` yazmış ve stream'i başlatmışken bir disk ya da
veritabanı hatası gelirse, o çağrı `ERR_HTTP_HEADERS_SENT` üretir; istemci sessizce kesik bir
dosya alırken Sentry bir 500 kaydeder. Bu, filtrenin kapsamadığı tek hata sınıfıdır ve yalnızca
bu, JSON dışında bir şey döndüren ilk uç olduğu için vardır.

**MIME reddinin neden özellikle 415 olması gerekiyor.** Nest'in `transformException`'ı
`LIMIT_FILE_SIZE`'ı `PayloadTooLargeException`'a eşler, yani fazla büyük bir yükleme bedavaya
doğru zarfa düşer. Ama son satırı, tanımadığı her şeyi olduğu gibi döndürür — dolayısıyla bir
`fileFilter`'dan fırlatılan düz bir `Error`, exception filtresinin `instanceof Error` dalına
ulaşır ve Sentry'ye raporlanan bir 500'e dönüşür. Yanlış dosya tipi ekleyen bir kullanıcı sunucu
arızası olarak loglanırdı. `UnsupportedMediaTypeException` fırlatmak, kullanıcının hatasını
kullanıcının hatası olarak tutan şeydir.

Bu kural umut değil, mekanik olarak garantilidir ve garantiyi adlandırmaya değer:
`transformException`, `if (!error || error instanceof HttpException) return error` ile başlar,
yani herhangi bir Nest HTTP exception'ı dokunulmadan geçer. Kural, multer'ın bir şeyi tanımasına
bağlı değildir.

**Aynı fonksiyonda, hiçbir tip denetleyicisinin yakalayamayacağı bir tehlike.** `switch`'i tip
üzerinde değil `error.message` üzerinde eşleşiyor — yani mesajı multer'ın string sabitlerinden
birine denk gelen bir hata sessizce dönüştürülür. `File too large` yazan el yazımı bir depolama
hatası, istemciye hiç seçmediği bir 413 olarak varır. Derleyicide bir string çakışmasını fark
eden hiçbir şey yoktur, bu yüzden `storage/` modülünün kendi hata mesajları multer'ın
sabitlerinden bilinçli olarak kaçınacak şekilde yazılır ve bu paragraf o kuralın kayıtlı olduğu
tek yerdir.

**Proxy sözleşmesinin neden bir gövde-boyutu satırına ihtiyacı var.** Sözleşme pazarlığa kapalı
olarak yayınlanıyor ve operatör Caddy'yi değiştirebilsin diye nginx karşılıklarını listeliyor.
İstek gövdesi boyutu hakkında hiçbir şey söylemiyor ve bu sessizlik yansız değil: Caddy limit
koymaz, yükleme çalışır; nginx ise `client_max_body_size`'ı varsayılan **1 MB** yapar, aynı
yükleme operatörün hiçbir yazılı şeye bağlayamayacağı bir `413` ile düşer. Dokümantasyonu en
dikkatli izleyen operatör, bozuk kurulumu alan kişi olur. Multer'ın kendi `limits.fileSize`
varsayılanı sınırsızdır — aynı sınıf yazılmamış bir karar, ve aynı sebeple açıkça set edilir.

**Grace period'un neden yedek penceresine bağlandığı.** "Diskte var, veritabanında yok" ancak
veritabanı otoriterken doğru bir predicate'tir. Restore'dan sonra değildir: `DROP DATABASE` ve
`pg_restore` satırları geri sararken disk olduğu yerde kalır. Dump alındıktan sonra yüklenen
dosyalar eşleşecek satır olmadan var olur ve o gece koşan bir süpürme onları kalıcı olarak siler
— restore ve süpürme tek başlarına güvenli, birlikte yıkıcıdır. Grace period'u
`BACKUP_KEEP × BACKUP_INTERVAL`'a bağlamak, bir dosyayı sahiplenmeyen bir dump hâlâ restore
edilebilirken hiçbir dosyanın süpürülememesi demektir. Aynı pencere, satırı henüz commit edilmemiş
bir yüklemeyle olan daha küçük yarışı da kapsar.

Sabit icat edilmiş değil ödünç alınmıştır ve mesele budur: o rotasyon dokümante edilmiş bir niyet
değil **prova edilmiş bir davranıştır** — Faz 0'ın yedekleme işi onu koşturdu ve 9'dan 7'ye
budamayı gösterdi. Süpürme böylece güvenli göründüğü için seçilmiş bir sayıya değil, tuttuğu
gözlenmiş bir davranışa bağlanıyor.

**`MailSender`'ın iskeleti neden kopyalanıp politikası kopyalanmıyor.** `sendWith` teslimat
hatalarını bilinçli olarak içeride tutuyor: "transactional mail is a side effect of a request,
never its result: a signup must not fail because the relay refused the connection." Depolama
bunu tersine çevirir. Başarısız bir yazma isteği düşürmek zorundadır, yoksa veritabanında
baytları var olmayan bir attachment satırı kalır. Taklit edilen modülün en karakteristik kararı,
taklit edilmemesi gereken tek karardır — ve tam da emsale bakan birinin onu kopyalayacak olması
nedeniyle yazılmaya değer.

## Sonuçlar

**Yayınlandığı gün yanlışlanacak dokümantasyon.** `development.md`'nin "all 17 tables" ifadesi —
şemada bugün tam 17 model var ve `Attachment` onu 18 yapıyor. `\dt` ile üç satır sayısını kontrol
edip diskte hiçbir şeye bakmayan restore doğrulaması. Redis'i bilinçli olarak yedeklenmeyen tek
şey diye adlandıran ve gerekçesini "because it is all rebuildable" diye veren paragrafı — ki artık
karşıt gerekçeli ikinci bir kayda ihtiyacı var. `.env.example`'ın "Scheduled **database** backups"
ifadesi. `backup.sh`'nin kendini "the Kurul database" ile sınırlayan başlık yorumu.
`configure-app.ts`'in "This service only ever answers with JSON" diyen CSP yorumu.
`api-conventions.md`'nin gövdesi olan her yanıtta `Content-Type: application/json; charset=utf-8`
şartı — ki dokümante bir istisna kazanıyor — ve ne 413 ne 415 içeren durum kodu tablosu.
Bunların hepsinin Türkçe aynaları aynı PR'da taşınır.

**API durum tutar hale gelir.** `api` servisinin bugün hiç `volumes:` anahtarı yok. Bu ilkini
ekliyor ve onunla birlikte bir replikanın hangi host'ta koşabileceğini adlandıran ilk dağıtım
kısıtını getiriyor. Servis `cap_drop: [ALL]` ve `no-new-privileges` altında `USER node` olarak
koşuyor ve compose yorumu servisin "never chowns" olduğunu iddia ediyor — dolayısıyla yükleme
dizini çalışma anında düzeltilmek yerine imajda zaten `node` sahipliğinde oluşturulur ve o iddia
doğru kalır.

**Süpürme, saklama modülünün biçimini kırar ve bunu söyler.** Mevcut beş süpürmenin hepsi
`$executeRaw` batch silmeleridir: saf SQL, batch başına implicit transaction, idempotent, yan
etkisiz ve `deleteInBatches`'in `() => Promise<number>` imzasına oturuyorlar. Bir dosyayı unlink
etmek bunların hiçbiri değil — ne transactional ne geri alınabilir. Yetim süpürmesi aynı worker'da
yaşar ve aynı sayaçlara raporlar, ama o yardımcıyı yeniden kullanmaz.

**Emsali olmadığı için yeni bir test konvansiyonu.** `apps/api`'de hiçbir şey dosya sistemine
commit'lenmiş dosyaları okumak dışında dokunmuyor; `docs/testing.md`'de buna dair kural yok ve
e2e suite'i hiç dosya yüklemedi. Entegrasyon testlerinde Prisma'yı mock'lamayı yasaklayan aynı
felsefeyi izleyerek depolama **gerçek bir geçici dizine** karşı test edilir; mevcut `db.ts`'in
yanında bir `test/helpers/storage.ts` temizleme yardımcısıyla. Bellek tabanlı bir backend
reddedildi: yalnızca testler için var olan bir sınıf olurdu ve bu kod tabanında böyle bir emsal
yok.

**Kapsam, alışılmışın tersi yönde gerçek bir risk.** API'nin Jest yapılandırmasında tek bir global
eşik ve `collectCoverageFrom: ['**/*.(t|j)s']` var, yani yeni bir modül otomatik olarak sayılır ve
ortalamayı aşağı çeker. Eşiğin üstündeki pay kabaca 2,6-3,3 puan. Yetersiz test edilmiş bir
depolama modülü, kimse test silmeden CI'ı kırmızıya çevirebilir. Yeni bir floor gerekmiyor;
kapsam gerekiyor.

**Bağımlılıklar neredeyse hiç kıpırdamıyor.** `multer` zaten `@nestjs/platform-express`'in,
`file-type` ise `@nestjs/common`'ın doğrudan bağımlılığı, yani ikisi de yeni kurulum değil.
`@types/multer` devDependency olarak eklenir — ya da dosya şekli, `smtp-mail-sender.ts`'in kendi
transporter'ını zaten tiplediği gibi ve aynı sebeple yapısal olarak tiplenir. `file-type` v21 saf
ESM ve API CommonJS'e derleniyor, dolayısıyla `await import()` ile erişilir ve Jest'in
`transformIgnorePatterns` beyaz listesine eklenir.

**Rate limit, yeterliymiş gibi yapılmak yerine yetersiz olarak adlandırılıyor.** Throttler
istekleri IP ve route başına sayar. Bu, yüklemeler için iki kez yanlış birimdir: yirmi adet 100 MB
istek ile yirmi adet 10 kB istek aynı bütçeyi harcar ve tek NAT arkasındaki bir ofis tek kovayı
paylaşır. Asıl tavan `limits.fileSize` artı workspace başına bir depolama kotasıdır. IP başına
izleme kabul edilmiş bir kısıt olarak kalır; `ThrottlerGuard.getTracker`'ı geçersiz kılmaya burada
girişilmez.

**Ayrık alan adı kullanan dağıtımlar görselleri `<img src>` ile değil `fetch` ve `blob:` ile
önizler.** Web CSP'sindeki `img-src 'self'`, mutlak bir API URL'iyle genişlemiyor —
`connectSources` o origin'i yalnızca `connect-src`'e ekliyor. Aynı-origin varsayılanı etkilenmiyor.

## Değerlendirilen alternatifler

| Alternatif                                         | Neden olmadı                                                                                                                                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baytları Postgres'te `bytea` olarak sakla          | Yedeklemeyi, saklamayı, cascade'i ve yetimleri tek hamlede çözüyor — ve koruduğu şeyi yok ediyor: dump'lar her dosyanın boyutu kadar büyür ve ilan edilmiş ≤2 saatlik RTO çok gigabaytlık bir restore'da yaşamaz |
| Baştan S3/MinIO şart koş                           | Zaten object storage çalıştıran azınlık için çoğunluğun beş dakikalık Compose kurulumunu bozar                                                                                                                   |
| İlk sürümde disk ve S3'ü birlikte yayınla          | Bildirilmiş hiçbir dağıtımın henüz ihtiyaç duymadığı bir backend için iki kod yolu ve iki test matrisi; port bunu ileride eklenen bir dosya yapıyor                                                              |
| İndirme için imzalı URL                            | Yetkilendirmeyi, operatörün değiştirmeye davet edildiği bir proxy'ye taşıyamıyor, dolayısıyla yalnız guard zincirinin kaybını ve çerezde olmayan bir iptal problemini satın alıyor                               |
| Dosyaları web origin'inden servis et               | O origin `script-src`'te zaten `'unsafe-inline'` taşıyor; API'nin `default-src 'none'`'ı saldırgan kontrollü içerik için kesinlikle daha güçlü                                                                   |
| Silme yolunda dosyaları satır içinde sil           | `Workspace → Board → Task` uygulama kodunu çağırmadan Postgres içinde cascade ediyor, dolayısıyla bu yol her toplu silmeyi kaçırırdı                                                                             |
| Yetimleri grace period'suz süpür                   | Bir restore'un ardından ilk gece, en son dump'tan sonra yüklenen her dosyayı siler                                                                                                                               |
| Beyan edilen `Content-Type`'a ya da uzantıya güven | İkisi de çağıran tarafından verilir; hiçbiri bir şeyin kanıtı değildir                                                                                                                                           |
| Testler için bellek tabanlı bir depolama backend'i | Yalnızca testler için var olurdu; oysa `LogMailSender` aynı zamanda bir üretim fallback'i                                                                                                                        |
| Bir `ATTACHMENTS_ENABLED` bayrağı ekle             | Bu kod tabanı `_ENABLED`'ı varsayılan-açık kill switch'lere ve rızaya ayırıyor; çalışmak için bir yola ihtiyaç duyan varsayılan-kapalı bir özellik, o yol set edilerek açılır                                    |
