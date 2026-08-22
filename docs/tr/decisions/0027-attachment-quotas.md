# 0027. Dosya Eki Depolama Kotaları: Workspace Başına ve Instance Geneli Yumuşak Bayt Tavanları

**Durum:** Kabul edildi
**Tarih:** 2026-08-18

> 🌐 [English (kanonik)](../../decisions/0027-attachment-quotas.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

> **Güncellendi (2026-08-21):** aşağıdaki kararın "ayarlanmamış = sınırsız" yarısı tersine
> çevrildi. Ayarlanmamış `ATTACHMENT_WORKSPACE_QUOTA_BYTES` artık 2 GiB, ayarlanmamış
> `ATTACHMENT_INSTANCE_QUOTA_BYTES` 20 GiB demek; yazılı bir `0` hâlâ vazgeçme seçeneği, negatif
> değer hâlâ açılışta reddediliyor. Dolayısıyla "Değerlendirilen alternatifler" tablosundaki
> "varsayılan bir kota sayısı" satırı artık reddedilmiş değil. Cevabı değiştiren şey: bu ADR'nin
> var olma nedeni olan bulgu (SEC-02, 2026-08-18 denetimi) _sınırsız_ tüketimdir ve yayınlanan
> Compose topolojisinde yapılandırılmamış bir instance diskini Postgres'le paylaşır; kota
> bölümünü hiç okumayan operatör, tam da dolu bir diskin veritabanını düşüreceği operatördür.
> 2 TB'lık bir volume için yanlış olan bir varsayılan o operatöre `.env`'de bir satıra mal olur;
> 20 GB'lık bir volume için yanlış olan bir varsayılan ise instance'a mal olur. Aynı değişiklik,
> aşağıdaki üçüncü ertelemenin işaret ettiği bayt bütçesini de yükleme route'una veriyor
> (`ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`, istemci IP'si başına dakikada 256 MiB,
> `UploadBudgetGuard`); böylece istek başına throttle, yapılandırılmamış bir instance'taki tek
> fren olmaktan çıkıyor. Upgrade sonucu ve kullanım sorgusu
> [self-hosting.md](../self-hosting.md#attachment-kotalarının-artık-varsayılanı-var)'de.
> Aşağıdaki gövde yazıldığı gibi bırakıldı.

## Bağlam

Attachment yükleme yolunun dosya başına bir tavanı (`ATTACHMENT_MAX_BYTES`,
[ADR 0024](0024-attachment-kinds-and-serving-policy.md)) ve IP başına bir istek throttle'ı var;
_toplamı_ sınırlayan hiçbir şey yok. `rate-limit.ts` bunu throttle'ın çıktığı günden beri açıkça
söylüyor: throttler istekleri sayar, disk için yanlış birimdir ve "gerçek tavan `limits.fileSize`
artı henüz var olmayan bir workspace başına kotadır." 2026-08-18 denetimi bu cümleyi SEC-02
olarak kayda geçirdi: varsayılanlarla, kimliği doğrulanmış tek bir istemci dakikada
`ATTACHMENT_UPLOAD_RATE_LIMIT × ATTACHMENT_MAX_BYTES` ≈ 500 MiB diski süresiz olarak
harcayabilir — ve yayınlanan Compose topolojisinde `STORAGE_PATH`, Postgres'le aynı dosya
sistemini paylaşır; onu doldurmak attachments'ı yavaşlatmaz, instance'ı düşürür. Bu ADR, eksik
olan kotayı sağlar.

## Karar

**İki tavan; ikisi de ortam değişkeniyle yapılandırılır, ikisi de varsayılan olarak kapalıdır.**
`ATTACHMENT_WORKSPACE_QUOTA_BYTES` bir workspace'in FILE eklerinin toplam `size` değerini,
`ATTACHMENT_INSTANCE_QUOTA_BYTES` aynı toplamı instance genelinde sınırlar. İkisi de
`storage-config.ts` içinde `ATTACHMENT_MAX_BYTES`'ın yanında, `envInt` ile okunur; negatif değer
boot'ta reddedilir.

**Boş ya da `0` sınırsız demektir.** Bu, upgrade davranışıdır — değişkenleri hiç ayarlamayan bir
instance, sahip olduğu yükleme yolunu sorgusu sorgusuna korur — ve bu kod tabanının yerleşik iki
yazımına birden uyar: özellikler bir değerin varlığıyla açılır (`STORAGE_PATH`, `SMTP_HOST`) ve
`0`, retention süpürmelerinde zaten "pencere yok" demektir
([ADR 0020](0020-data-retention.md)). Tartışılacak bir varsayılan sayı yok, çünkü hem bir
Raspberry Pi hem de 2 TB'lık bir volume için doğru olan sayı yoktur; disk bütçesi olan operatör
onu kendisi söyler.

**Kota yüklemede, canlı satırlar üzerinden ve kapsayıcı olarak uygulanır.** `createFile`,
`SUM(size) WHERE kind = 'FILE'` sorgusunu (önce workspace kapsamında, sonra instance denetimi
için kapsamsız) çalıştırır ve toplam artı gelen dosya kotayı _aşacaksa_ reddeder — kotayı tam
dolduran dosya kabul edilir; `ATTACHMENT_MAX_BYTES`'ın kendi kapsayıcı tavanıyla aynı kural.
Denetim MIME sniff'inden sonra (reddedilen tür, kota ne derse desin reddedilir) ve bayt
yazımından önce (kotayı aşan yükleme diske hiç dokunmaz) çalışır. İki kota da `0` iken hiç sorgu
atılmaz.

**Kota yumuşaktır ve bu bir ihmal değil, adlandırılmış bir karardır.** Denetim
check-then-write'tır: aynı anda denetimi geçen N yükleme birer dosya kadar aşabilir — istek
başına `ATTACHMENT_MAX_BYTES` ile sınırlı. Bu pencereyi workspace başına advisory lock ya da
rezervasyon satırıyla kapatmak değerlendirildi ve reddedildi: bir workspace'in tüm yüklemelerini
serileştirir ya da hata halinde kendisi temizlenmesi gereken bir defter satırı icat eder (ikinci
bir orphan sınıfı) — üstelik kimsenin ihtiyacı olmayan bayt hassasiyeti uğruna; tehdit modeli
_sınırsız_ tüketimdir ve aşım sınırlıdır. **Tetikleyici:** eşzamanlı aşımın tek bir
`ATTACHMENT_MAX_BYTES`'ı kayda değer biçimde aştığı ölçülmüş bir kurulum ya da kotanın kasten
yarıştırıldığına dair operatör raporu. **Tetiklendiğinde maliyeti:** denetim ile satır yazımının
etrafında, workspace id'siyle anahtarlanan transaction kapsamlı bir `pg_advisory_xact_lock` —
yalnızca `createFile`'a dokunan bir değişiklik.

**LINK ekleri hiçbir şey harcamaz.** Bir LINK bayt saklamaz (`size` `null`'dur,
[ADR 0024](0024-attachment-kinds-and-serving-policy.md)); ne kotadan düşer ne de dolu bir kota
tarafından reddedilir. Toplamdaki `kind = 'FILE'` koşulu, bu cümlenin SQL hali.

**Ret, `error` alanı kendine ait bir 413'tür.** Zarf `error: "Attachment Quota Exceeded"`
taşır — `@kurul/shared-types` içinde bir sabit; API bir kez yazar, web onun üzerinden dallanır.
Dosya başına limitin 413'ü ise standart `"Payload Too Large"` taşır. İstemciler `statusCode` ve
`error` üzerinden dallanır, asla `message` üzerinden değil
([api-conventions.md](../api-conventions.md#hatalar)); ve bu, tek route üzerinde durum kodunun
hangi çözümü önereceğini tek başına söyleyemediği ilk hata çiftidir: daha küçük bir dosya, dolu
bir workspace'i düzeltmez. `507 Insufficient Storage` reddedildi: `AllExceptionsFilter` her
5xx'i tasarım gereği hata izlemeye raporlar; kota reddi, yapılandırmanın çalışmasıdır, sunucunun
bozulması değil.

**Ertelenenler, her biri tetikleyicisiyle:**

- **Kullanıcı başına kotalar.** **Tetikleyici:** tek bir üyenin paylaşılan workspace kotasını
  tükettiğine dair ilk rapor. **Tetiklendiğinde maliyeti:** üçüncü bir değişken ve aynı
  aggregate'in `uploadedById` ile anahtarlanması.
- **Kullanım okuması (endpoint ve panel metni).** **Tetikleyici:** bir kullanıcının
  workspace'inin ne kadar dolu olduğunu 413 söylemeden öğrenemediği ilk destek konusu.
  **Tetiklendiğinde maliyeti:** bu denetimin zaten hesapladığı toplamı yanıtlayan tek bir okuma
  endpoint'i, artı UI.
- **Yükleme throttle'ının kullanıcı/workspace ile yeniden anahtarlanması.** ADR 0022'nin
  ertelemesinden farksız; throttle'ın hiç olmadığını söylediği gerçek tavan artık kota.

## Gerekçe

**Neden yükleme anında `SUM`, saklanan bir kullanım sayacı değil.** Denormalize sayaç, onu
kaçıran ilk silmede sapar ve burada her toplu silme onu yapısal olarak kaçırır:
`Workspace → Board → Task` cascade'i tamamen Postgres içinde, hiçbir uygulama kodu çalışmadan
iner (orphan süpürmesini zaten zorunlu kılan aynı özellik, ADR 0022). Canlı satırlar üzerindeki
toplam, her cascade'den sonra tanım gereği doğrudur. Bunun için indeks eklenmedi — önce-ölç
emsali ([ADR 0020](0020-data-retention.md)'nin #187 güncellemesi ve ondan önceki
`drop_unused_indexes` migration'ı): aggregate mevcut ilişki
join'ine biner, yüklemeler 20/dk/IP ile sınırlıdır ve denetim yapılandırılmamış instance'larda
hiç çalışmaz. Bir indeks yerini korkuyla değil ölçümle kazanır.

**Neden kota satırları sayar, diski değil.** Veritabanı otoritedir; disk onu iki yönde de
geriden izler (baytlar satır commit olmadan yazılır, orphan'lar süpürmenin bekleme süresini
bekler). `du` ile ölçülen bir kota, kiracılara kimseye ait olmayan orphan'ları faturalandırır.
Dürüstçe kaydedilen sonuç: bir dosyayı ayırmak kotayı hemen boşaltırken baytları süpürmeyi
bekler; yani _disk_ kullanımı, bekleme penceresi geçene kadar kota muhasebesini orphan nüfusu
kadar aşabilir.

## Sonuçlar

- `rate-limit.ts:44-52` içindeki bayat cümle kotaları gösterecek şekilde yeniden yazıldı;
  ADR 0022'nin "rate limiting yetersiz diye adlandırılır" paragrafının öbür yarısı artık var.
- `.env.example`, `development.md`'nin ortam tablosu, `self-hosting.md`'nin boyutlandırma bölümü
  ve `api-conventions.md`'nin 413 satırı iki değişkeni ve hata şeklini kazandı; Türkçe aynalar
  aynı PR'da.
- Web'in yükleme hata yolu ilk kez zarfın `error` alanı üzerinden dallanıyor
  (`resolveApiMessage` `byError` kazandı); yeni metin iki kataloğa da girdi.
- Disk boyutlandıran bir operatörün bütçesi: instance kotası + makul her eşzamanlı yükleme için
  bir `ATTACHMENT_MAX_BYTES` (yumuşak aşım) + bir bekleme penceresinin orphan nüfusu.

## Değerlendirilen alternatifler

| Alternatif                                       | Neden olmaz                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Sert kota (advisory lock ya da rezervasyon)      | Zaten tek dosyayla sınırlı bir aşımı kapatmak için workspace'in yüklemelerini serileştirir ya da kendisi temizlik sorunu olan satır yaratır   |
| `Workspace` üzerinde denormalize kullanım sayacı | Her cascade silme, sayacı azaltacak kod çalışmadan Postgres içinde iner; en çok yer açan yollarda kalıcı olarak sapar                         |
| Varsayılan bir kota sayısı                       | Hem Raspberry Pi hem 2 TB volume'a uyan sayı yok; upgrade sonrası yüklemeleri reddeden bir varsayılan, kimsenin yapılandırmadığı bir gerileme |
| `507 Insufficient Storage`                       | Filtrenin sinyal politikası her 5xx'i hata izlemeye raporlar; kota reddi sunucunun bozulması değil, yapılandırmanın çalışmasıdır              |
| İki 413'ü `message` ile ayırmak                  | api-conventions `message` üzerinden dallanmayı yasaklar; `error` alanı tam olarak bunun için var                                              |
| LINK satırlarını kotaya saymak                   | LINK bayt saklamaz; hiçliğin bayt kotası, disk boşken bedava satırları reddederdi                                                             |
| Satırlar yerine diski (`du`) ölçmek              | Kiracılara süpürmeyi bekleyen orphan'ları faturalandırır ve bekleme süresiyle yarışır; neyin var olduğunun otoritesi veritabanıdır            |
