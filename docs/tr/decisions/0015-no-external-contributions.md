# 0015. Dış Katkı Kabul Edilmiyor; Hukuk Masrafı Ertelendi

**Durum:** [0028](0028-open-contributions-hosted-service.md) tarafından yerini aldı
**Tarih:** 2026-08-12

> 🌐 [English (canonical)](../../decisions/0015-no-external-contributions.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

> **Yerini aldı:** katkılar 2026-08-21'de [0028](0028-open-contributions-hosted-service.md) ile yeniden açıldı. Kod, doküman ve çeviri pull request'leri, CLA olmadan ve imzalanacak hiçbir şey olmadan, düz AGPL-3.0 altında yeniden kabul ediliyor. Aşağıdaki FSEK sorusunun artık cevaplanması gerekmiyor, çünkü hiçbir şey yeniden lisanslanmıyor. Bu kayıt tarihsel olarak duruyor; içindeki hiçbir şey yürürlükte değil.

## Bağlam

[ADR 0014](0014-dual-licensing-cla.md) iş modelini karara bağladı — çift lisanslama ve bunu hukuken mümkün kılan bir Katkıda Bulunan Lisans Sözleşmesi — ve `docs/cla.md` (2026-08-22'de silindi, git geçmişinde)'yi Harmony türevi bir taslak olarak, merge'ü bloklayan bir GitHub Actions kontrolüyle birlikte yayımladı. Aynı ADR, hukuki işin bitmediğini de dürüstçe kaydetti: belgede çözülmemiş `[FILL: …]` ve `[HUKUKÇUYA SOR: …]` işaretleri ve öne çıkan bir "yürürlükte değil" uyarısı var.

Bu açık soruların en zoru yüzeysel bir eksiklik değil. Sahip, Türkiye mukimi bir gerçek kişi; dolayısıyla FSEK (5846 sayılı Kanun) uygulanıyor ve FSEK, bir eser üzerindeki mali haklara ilişkin sözleşmelerin **yazılı** olmasını şart koşuyor. Bir GitHub pull request yorumunun bu şekil şartını karşılayıp karşılamadığı — ve şartın alt lisans verilebilir bir lisans vermeye uzanıp uzanmadığı, yoksa yalnızca tam bir devri mi kapsadığı — dokümantasyondan akıl yürüterek çözülebilecek bir şey değil. Hukukçu gerektiriyor ve cevap, o güne kadar toplanmış her imzanın bir işe yarayıp yaramadığını belirliyor.

Sahip bu görüşmeyi şimdi yapmayacak ve aklında bir tarih de yok. Bu da CLA'yı öngörülebilir gelecekte uygulanamaz bırakıyor, ve taslak bir metne karşı imza isteyen canlı bir CLA kontrolünü ortada bırakıyor. İncelemenin kısa sürede geleceğini varsayan bir karar artık gerçeği tarif etmiyor; o hâlde gerçeğin kendisi yazılmalı.

## Karar

**Kurul dış katkı kabul etmiyor.** Dışarıdan gelen hiçbir kod, doküman veya çeviri pull request'i merge edilmiyor. Kod tabanı tek yazarlı kalıyor: sahip kodu kendisi yazıyor ve kodun tamamının telifi tek elde kalıyor — [SQLite](https://www.sqlite.org/copyright.html)'ın onlarca yıldır yürüttüğü model. Hata bildirimleri, özellik fikirleri, tasarım geri bildirimi ve tartışma her zamanki kadar isteniyor; tek satırlık bir yazım hatası veya kırık bağlantı düzeltmesi hâlâ tartışmaya değer bir telif taşımıyor ve hâlâ hoş karşılanıyor.

**CLA taslağı korunuyor, yürürlüğe konmuyor.** `docs/cla.md` (2026-08-22'de silindi, git geçmişinde) "yürürlükte değil" uyarısı yerinde kalmak üzere depoda duruyor ve CLA workflow'u (`.github/workflows/cla.yml`, 0028 ile silindi, son hali git geçmişinde) silinmek yerine devre dışı bırakılıyor — tetikleyiciler `workflow_dispatch`'e indirildi ve job `if: ${{ false }}` ile korumaya alındı. İş yapılmış ve hazır bekliyor; hukuki inceleme bir gün gerçekleşirse etkinleştirmek küçük bir değişiklik, yeniden yazım değil.

**Hukuk masrafı ilk ticari satışa erteleniyor.** Bu projenin asıl ihtiyaç duyduğu hukukçu CLA için değil, ticari lisans sözleşmesi için; o belge de ancak imzalayacak ödeme yapan bir müşteri olduğunda gerekiyor. O noktada gelir ücreti gerekçelendiriyor ve müşterinin kendi hukukçusu da metni inceliyor — tek masrafa iki okuma.

Bu ADR, [ADR 0014](0014-dual-licensing-cla.md)'ün **yerini almıyor**. 0014'ün hedef modeli — tek bir AGPL-3.0 kod tabanı, paralelde ticari lisansla satılan aynı kod, ve her dış katkıyı kapsayan bir CLA — hedeflenen varış noktası olmaya devam ediyor. 0015 oraya giden yolu askıya alıyor: CLA yarısı hukuki inceleme gerçekleşene kadar uykuda, katkı yarısı ise bu arada kapalı — ki geriye dönük olarak CLA gerektirecek hiçbir şey birikmesin.

## Gerekçe

- **%100 telif sahipliği hiçbir kapıyı kapatmıyor.** Tek yazar olarak sahip çift lisanslayabilir, ticari lisans satabilir, yeniden lisanslayabilir veya kaynağı tamamen kapatabilir — ADR 0014'ün istediği her seçenek, istemediği birkaçı da dahil, kimseye sormadan elde. CLA yalnızca bu özgürlüğü parça parça verdikten sonra geri satın almak için var. En baştan hiç vermemek kesinlikle daha basit.
- **CLA, projenin henüz sahip olmadığı bir sorunu çözüyor.** Dış katkıları yönetmek için bir mekanizma ve ortada sıfır dış katkıcı var. Var olmayan bir trafiği yönetmek üzere incelenmemiş hukuki mekanizma kurmak, faydasız risk demek: risk gerçek (geçersiz imzalar), fayda varsayımsal (henüz ortaya çıkmamış bir katkıcı).
- **Geçersiz imza toplamak, hiç toplamamaktan kötü.** FSEK'in şekil şartını karşılamayan bir imza kendini ele vermez. Defterde koruma gibi görünerek durur ve kusur en kötü anda ortaya çıkar — ticari bir müşterinin durum tespiti sırasında, kod sahibin vermeye hakkı olmayabilecek şartlarla çoktan teslim edilmişken. Sıfır imza, planlanabilir, açık ve dürüst bir boşluktur. Bir çekmece dolusu uygulanamaz imza ise gizli bir yükümlülüktür.
- **Taslak metne karşı canlı bir kontrol, dağınıklık değil saygısızlık.** Bugün bir kod pull request'i açan kişiden bot, zaten merge edilmeyecek bir PR'ı açmak için incelenmemiş bir hukuki belgeyi imzalamasını istiyor. Dürüst olan, katkıyı baştan reddetmek ve botu kapatmak.
- **Erteleme, doğru işlem sırasının en ucuzu.** CLA incelemesine şimdi ödeme yapmak, kimsenin sunmadığı katkıları kabul etme hakkını satın alıyor. Ticari lisans incelemesine ilk satışta ödeme yapmak ise imzalandığı gün gelir üreten bir belge satın alıyor.

## Sonuçlar

- **Kod yazan bir topluluk oluşmuyor.** Bu, açık kaynağın en büyük avantajlarından birinden — dışarıdan gözler, dışarıdan yamalar, dışarıdan bakım — vazgeçmek demek ve bu kararın en büyük maliyeti; isteksizce değil, bilinçli olarak göze alınıyor. Kod hâlâ açık, okunabilir, fork'lanabilir ve AGPL-3.0 ile self-host edilebilir; kapalı olan, içeri gelen yol.
- **Tek geliştirici darboğaz.** Proje büyürse üretim hızı tek kişinin zamanıyla sınırlı ve bunu rahatlatacak bir mekanizma yok. Birikmiş iş devredilemiyor ve bus factor'ün bir olması hiçbir şeyle telafi edilmiyor.
- **Yardım etmek isteyenler geri çevrilecek ve bir kısmı bunu kişisel algılayacak.** Reddedilen bir pull request, gerekçesi ne kadar dikkatli yazılırsa yazılsın reddedilme olarak okunuyor ve bazı katkıcılar projenin gerçekten açık kaynak olmadığı sonucuna varacak. [CONTRIBUTING.md](../../../CONTRIBUTING.md) bu duruşu açıkça ve önceden söylüyor ki kimse emeğini harcadıktan sonra öğrenmesin; bu konuda yapılabilecek en fazlası bu.
- **Duraklamanın bitiş tarihi yok.** ADR 0014 CLA'nın yürürlüğe gireceği beklentisiyle yazılmıştı; bu karar bilinçli olarak hiçbir takvim vaat etmiyor, çünkü kayan bir tarih vaadi dürüst bir "belirsiz"den daha kötü.
- **Karar geri alınabilir ve geri alındığı an sorun aynen geri geliyor.** Katkıları yeniden açmak önce CLA'nın yürürlükte olmasını, o da bu ADR'nin ertelediği hukuki incelemeyi gerektiriyor — FSEK sorusu zamanla ne kolaylaşıyor ne ucuzluyor. Buradaki hiçbir şey tek yönlü bir kapı değil, ama kapı yalnızca 0014'ün tarif ettiği sırayla açılıyor.
- **Dokümantasyonun tek dilde kanonik kalması artık gelenek değil zorunluluk.** Çeviri katkıları kapalı olduğu için `docs/tr/` altındaki Türkçe ayna, güncel tutulması sahibin kendi işi olan bir yük olmaya devam ediyor.
- **Uykudaki CLA mekanizması ara sıra bakım isteyecek.** `contributor-assistant/github-action` arşivlenmiş durumda (ADR 0014) ve er ya da geç GitHub runner'larında çalışmayı bırakacak. Workflow silinmek yerine devre dışı bırakıldığı için bu çürüme, biri onu yeniden açmayı denerken fark edilecek.

## Değerlendirilen Alternatifler

| Alternatif                                             | Neden değil                                                                                                                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLA'yı hukukçu incelemesi olmadan yürürlüğe koymak     | İmzalar FSEK'in yazılı şekil şartını karşılamayıp değersiz olabilir ve kusur, kod çoktan teslim edildikten sonra ticari bir müşterinin durum tespitinde ortaya çıkar. Görünmez bir kusur, görünür bir boşluktan kötüdür          |
| Çift lisanslamadan vazgeçip katkıları saf AGPL almak   | CLA gerekmezdi ve topluluk yolu açık kalırdı, ama ticari model kapanırdı: katkı gelen kod ticari lisanslı bir build'de asla yer alamaz ve ADR 0007'nin kaldıracı satılamaz hâle gelirdi. Sahip iş modelinden vazgeçmek istemiyor |
| Hukukçuyla şimdi görüşmek                              | Doğru çözüm ve plan olmaya da devam ediyor — reddedilmedi, ertelendi. Bugün, kimsenin sunmadığı katkıları lisanslamak için, arkasında gelir olmayan bir masraf                                                                   |
| Katkıları yalnızca DCO ile kabul etmek                 | Menşei tasdik ediyor, yeniden lisanslama hakkı vermiyor (ADR 0014). Katkı gelen kodun her ticari build'den dışlanması gerekirdi; ortak koda dokunduğu anda bu uygulanamaz                                                        |
| CLA kontrolünü canlı tutup tavsiye niteliğine indirmek | Bot yine de katkıcıdan, merge edilmeyecek bir PR'ı açmak için taslak bir metni imzalamasını istiyor. Emeğini boşa harcıyor ve projenin gerçek durumunu yanlış anlatıyor                                                          |
| CLA taslağını ve workflow'u silmek                     | Düzen uğruna bitmiş işi çöpe atıyor. İkisi de devre dışıyken atıl duruyor ve hazır olmaları, kararı geri almayı ucuzlatan şeyin ta kendisi                                                                                       |
