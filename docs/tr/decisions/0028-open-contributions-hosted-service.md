# 0028. AGPL-3.0 Altında Açık Katkılar, CLA Yok; Gelir Yalnızca Barındırılan Bir Servisten

**Durum:** Kabul edildi ([0014](0014-dual-licensing-cla.md) ve
[0015](0015-no-external-contributions.md)'in yerini alır)
**Tarih:** 2026-08-21

> 🌐 [English (kanonik)](../../decisions/0028-open-contributions-hosted-service.md) | Türkçe (bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir)

> **Güncellendi (2026-08-22):** `docs/archive/` CLA taslağıyla birlikte tamamen kaldırıldı. Aşağıda
> `docs/cla.md`'yi `docs/archive/cla-draft.md`'ye taşıyan sonuç uygulandı ve bir gün sonra geçersiz
> kaldı; taslak artık yalnızca git geçmişinde.

## Bağlam

[ADR 0007](0007-license-agpl.md) AGPL-3.0'ı seçti. [ADR 0014](0014-dual-licensing-cla.md) bunun
üzerine bir iş modeli kurdu: aynı kodun kurumlara ayrı bir ticari lisansla satılması. Bu, maintainer'ın
her satır üzerinde yeniden lisanslama hakkını elinde tutmasını gerektiriyor; o da her dış katkıda
bulunanın bir Katkıda Bulunan Lisans Sözleşmesi imzalamasını gerektiriyor.
[ADR 0015](0015-no-external-contributions.md) ardından şunu kayda geçirdi: CLA bir hukukçu incelemesi
olmadan yürürlüğe konamaz (Türkiye mukimi bir maintainer için FSEK'in yazılı şekil şartı), böyle bir
inceleme planlanmıyor, ve dolayısıyla dışarıdan gelen kod, doküman ve çeviri pull request'leri hiç
merge edilmeyecek, bitiş tarihi de yok.

Aradan geçen aylarda sonucu basit oldu: kimse yardım edemedi. İnsanların vermeye hazır olduğu hata
düzeltmeleri, çeviriler ve küçük iyileştirmeler kapıda geri çevrildi, ve proje hiç var olmamış bir
gelir akışını korumak için tek yazarlı bir kod tabanı olarak yürüdü. Tek bir ticari lisans satılmadı,
hiçbiri talep edilmedi, ve bir satışı mümkün kılacak hukuki iş hiç ısmarlanmadı. Kapalı kapının
maliyeti gerçekti ve her gün ödendi; koruduğu fayda ise varsayımdan ibaretti.

Bu arada yaşayabilir bir işin şekli de netleşti. Kurul için para ödeyecek olanlar, AGPL'den muafiyet
isteyen kurumlar değil; sunucu işletmeden bir board isteyen ekipler. Bu bir barındırma işi, ve
barındırma işi yoğunlaştırılmış telif hakkı gerektirmiyor.

## Karar

1. **AGPL-3.0 kalıyor.** [ADR 0007](0007-license-agpl.md) değişmeden yürürlükte. Üçüncü bir tarafın
   kodu kapatıp bir servis olarak yeniden satmasını hâlâ lisans engelliyor.

2. **Çift lisanslama ve CLA terk ediliyor.** Ne bugün ne sonra bir ticari lisans sunuluyor veya
   satılıyor. CLA taslağı arşive alınıyor, devre dışı bırakılmış `CLA` workflow'u siliniyor, her
   README'den `licensing@` satırı kaldırılıyor, ve hiçbir katkıda bulunandan imza, sözleşme veya
   işveren onayı istenmiyor.

3. **Dış katkılar kabul ediliyor.** Kod, doküman ve çeviri pull request'leri yeniden hoş karşılanıyor.
   Lisans koşulları inbound = outbound: bir katkı gönderdiğinizde onu projenin AGPL-3.0'ı altında
   lisanslamış olursunuz, yani zaten her kullanıcının sahip olduğu koşullarla, ve telif hakkınız sizde
   kalır. Bu, GitHub'ın varsayılanıdır (Hizmet Şartları, bölüm D.6) ve hiçbir evrak gerektirmez.
   Önemsiz olmayan işler için önce issue açma kuralı, ~500 satırlık PR ölçüsü ve merge öncesi review
   (tek maintainer olduğu sürece maintainer kendi PR'larını kendisi gözden geçirir) olduğu gibi kalıyor.

4. **Gelir tek bir yerden geliyor: Dravcore'un işlettiği barındırılan bir servis.** Bizim
   sunucularımızda bir hesap; yayınlanmış bir limit kümesinin içinde ücretsiz, üzerinde ücretli.
   Limitler özellik değil, operasyonel büyüklüklerdir (koltuk, board, depolama ve benzeri).

5. **Self-host ücretsiz, sonsuza kadar, hiçbir şey saklı değil.** Kurul'u kendi sunucusunda
   çalıştıran hiç kimseden para istenmiyor, ve barındırılan servisten ayrı olarak satılan bir ürün
   yok. Open core yok: barındırılan servis, ihtiyaç duyduğu plan-limiti ve faturalama kodu dahil, bu
   depodaki aynı AGPL kodunu çalıştırıyor. Self-host eden kişi o limitleri istediği gibi ayarlar veya
   hiç açmaz.

Bu ADR, 0014 ve 0015'in yerini bütünüyle alır. 0007'yi tamamlar.

## Gerekçe

- **Kapı, koruduğundan fazlasına mal oluyordu.** ADR 0014, ticari lisansı mümkün tutmanın bedeli
  olarak "drive-by katkılar üzerinde gerçek ve kalıcı bir vergi"yi kabul etmişti. İki release sonra
  vergi tam olarak ödenmişti ve lisans hiçbir şey kazandırmamıştı. Gelir modeli buna dayanmaz hâle
  gelince, takası tersine çevirmek bariz düzeltme.
- **Barındırılan bir servis yeniden lisanslama hakkı gerektirmiyor.** AGPL muafiyeti satmak, her
  katkıyı yeniden lisanslama hakkına sahip olmayı gerektirir; 0014'ün bir CLA'ya ihtiyaç duymasının
  tek sebebi buydu. Kendi işlettiğiniz bir sunucudaki hesap için ücret almak ise böyle bir şey
  gerektirmez. Aynı kodu herkes çalıştırabilir; müşterinin satın aldığı şey, bunu kendisinin yapmak
  zorunda olmaması. İş bu hâle gelince CLA'ya iş kalmıyor, ve ADR 0015'in takıldığı hukuki soru (bir
  PR yorumunun FSEK'in şekil şartını karşılayıp karşılamadığı) artık cevap gerektirmiyor.
- **AGPL bu model için hâlâ doğru lisans.** Permissive bir lisans, bir rakibin Kurul'u özel
  iyileştirmelerle barındırıp servisin altını oymasına izin verirdi. AGPL'in network-use maddesi,
  değiştirilmiş bir Kurul'u barındıran herkesi değişikliklerini yayınlamaya zorluyor; bu da sahayı düz
  tutuyor ve iyileştirmelerin geri akmasını sağlıyor. ADR 0007'nin gerekçesi olduğu gibi duruyor;
  yalnızca koruduğu şey "satılacak bir lisans"tan "işletilecek bir servis"e döndü.
- **Şimdilik DCO değil, inbound = outbound.** Bir Developer Certificate of Origin, bir
  `Signed-off-by` satırı ve bir bot ekler, ve yalnızca kaynağı beyan eder. ADR 0014 bunu, yeniden
  lisanslama hakkı vermediği için reddetmişti; o zaman mesele buydu, şimdi ise ilgisiz. Bugün
  benimsenmiyor, çünkü bu ölçekteki bir proje için sürtünmesi henüz haklı değil; ileride bir
  CONTRIBUTING paragrafı ve bir CI kontrolüyle, geçmiş katkılara hiç dokunmadan eklenebilir.
- **Özellik değil limit, çünkü open core iyi sebeplerle reddedildi.** ADR 0007 ve 0014, bir
  community/proprietary sınırının sürekli maliyetini ve "açık kaynak" iddiasına koyduğu yıldızı
  ayrı ayrı andı. Operasyonel bir büyüklüğü ölçmek böyle bir sınır gerektirmiyor: aynı kod
  yapılandırılabilir bir tavanı uyguluyor, barındırılan instance ise o tavanı yapılandırıyor.

## Sonuçlar

- **Yeniden lisanslama kapısı kalıcı olarak kapandı, ve bu kabul edildi.** İlk dış katkı merge
  edildiği andan itibaren kod tabanı, maintainer dahil herkes için AGPL-3.0. İleride bir ticari lisans
  sunmak, geçmişteki her yazarın onayını gerektirir; bu da pratikte hiç sunulmayacağı anlamına gelir.
  ADR 0014 buna tek yönlü kapı demişti; bu ADR o kapıdan bilerek geçiyor.
- **Rakipler dahil herkes Kurul'u ticari olarak barındırabilir.** AGPL onları uzak durmaya değil,
  değişikliklerini yayınlamaya zorlar. Resmî servisin kalıcı avantajları işletme, destek, güven ve
  isimdir. Kurul adını marka olarak tescil etmek artık "bir gün" maddesi değil, gerçek bir devam işi.
- **Ürünün bir plan-limiti katmanı büyütmesi gerekiyor.** Workspace başına (ve instance genelinde)
  koltuk, board ve depolama için açık kod tabanında tek ve yapılandırılabilir bir uygulama noktası
  gerekiyor; bu, [ADR 0027](0027-attachment-quotas.md)'nin dosya eki baytları için kurduğu deseni
  genişletiyor: yapılandırmadan okunan yumuşak tavanlar, ayarlanmadığında sınırsız, aşıldığında açık
  bir hata koduyla `413` tarzı bir ret. Faturalama entegrasyonu ve plan ataması da aynı açık kodun
  parçası, yalnızca barındırılan instance'ın verdiği yapılandırmayla açılıyor. Kapsam ve sıralama
  [ROADMAP.md](../../../ROADMAP.md) içinde.
- **Dış işi review etmek artık gerçek maintainer zamanı.** CONTRIBUTING.md, PR şablonu ve
  `docs/coding-standards.md`, bir yabancının PR açmadan önce okuduğu sözleşme hâline geliyor;
  dolayısıyla neyin merge edildiği konusunda net olmaları gerekiyor. CI, fork'lardan gelen pull
  request'lerde güvenli kalmalı: secret'lar fork workflow'larına açılmıyor, ve secret gerektiren her
  şey merge sonrasında çalışıyor.
- **Üç doküman aynı anda anlam değiştiriyor.** CONTRIBUTING.md ve iki README, katkı-yok ve
  ticari-lisans dilini bırakıyor; `docs/cla.md`, "yürürlükte değil" uyarısı yerinde kalmak üzere
  tarihsel bir kayıt olarak `docs/archive/cla-draft.md`'ye taşınıyor; `.github/workflows/cla.yml` siliniyor
  (bir gün bir DCO kontrolü ona bakarak yazılırsa son hâli git geçmişinde duruyor); ADR 0014 ve 0015
  `Superseded by 0028` durum satırı alıyor. ADR 0007 ise 0014 yerine buraya işaret eden bir devam notu
  alıyor.
- **Güven iki taraflı bir maliyet.** Aylarca "katkıda bulunamazsınız" dedikten sonra "artık
  bulunabilirsiniz" demek özür gerektirmiyor, ama tutarlılık gerektiriyor: kapı açılıyorsa review
  gerçekten ve makul bir hızda olmalı; yoksa geri dönüş, ilk duraklamanın kaybettirdiğinden fazla iyi
  niyet kaybettirir.

## Değerlendirilen Alternatifler

| Alternatif                                                      | Neden değil                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0014 ve 0015'i olduğu gibi bırakmak                             | Katkı yok, gelir yok, ve kimsenin cevaplamaya niyeti olmayan açık bir hukuki soru. Mevcut durumun kendisi problemdi                                                                                                             |
| Hukuki incelemeyi ısmarlayıp CLA'yı yürürlüğe koymak            | Hiç talep görmemiş bir ticari lisans işini açmak için hukukçuya para ödemek, ve 0014'ün kendisinin kalıcı dediği katkı vergisini sürdürmek. Yanlış problemi çözüyor                                                             |
| Open core: yalnızca barındırılan sürümde proprietary özellikler | 0007 ve 0014'te, bakım sınırı ve "açık kaynak" iddiasına koyduğu yıldız yüzünden reddedildi; iki itiraz da hâlâ geçerli. Operasyonel büyüklüklere konan limitler, ikinci bir kod tabanı olmadan aynı fiyatlamayı sağlıyor       |
| Kaynağı görünür lisans (BSL, SSPL, Fair-code)                   | Rakiplerin Kurul'u barındırmasını engellerdi, ama açık kaynak iddiasını bitirir, dağıtımlarca paketlenmenin önünü keser ve tam da bu kararın kazanmaya çalıştığı katkıda bulunanları uzaklaştırır                               |
| İlk günden bot'lu DCO                                           | Makul ve ucuz, ama bedava değil: her katkıda bulunanın unuttuğu bir trailer ve ilk PR'ını bloklayan bir kontrol. Katkı hacmi haklı çıkarana kadar ertelendi; sonradan eklemek geçmişe dönük hiçbir şeye mal olmuyor             |
| Permissive lisans (MIT / Apache-2.0)                            | Bir rakibin Kurul'un kapalı bir fork'unu özel iyileştirmelerle barındırmasına izin verirdi; bir barındırma işinin kaldıramayacağı tek şey de bu. ADR 0007'nin SaaS-yeniden-satış argümanı şimdi daha az değil, daha çok geçerli |
