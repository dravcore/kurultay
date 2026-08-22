# 0007. Lisans: AGPL-3.0

**Durum:** Kabul edildi
**Tarih:** 2026-08-08

> 🌐 [English (canonical)](../../decisions/0007-license-agpl.md) | Türkçe — Bu çeviri güncel olmayabilir; kanonik kaynak İngilizce'dir.

> **Devamı:** aşağıda açık bırakılan ticari model [0028](0028-open-contributions-hosted-service.md)'de karara bağlandı: AGPL-3.0 kalıyor, iş modeli ise çift lisanslama değil (onu 0014 önermişti, 0028 terk etti), Dravcore'un işlettiği isteğe bağlı bir barındırma servisi. 0028 bu kaydı tamamlıyor, yerini almıyor.

## Bağlam

Kurul, üçüncü bir tarafça alınıp katkıda bulunma zorunluluğu olmadan kapalı kaynak bir SaaS olarak yeniden satılması makul biçimde mümkün olan, açık kaynak bir proje yönetim aracı. Lisans, bu sonucu engellerken maintainer'lar için sürdürülebilir bir iş modeline gerçekçi bir yol bırakmalı.

## Karar

**AGPL-3.0**.

## Gerekçe

- AGPL-3.0, düz GPL'in açık bıraktığı network-use boşluğunu kapatıyor: değiştirilmiş kodu bir network servisi olarak çalıştırmak GPL altında "dağıtım" sayılmıyor, dolayısıyla GPL tek başına bir SaaS operatörünü değişikliklerini yayınlamaya zorlamıyor. AGPL'in network-use maddesi bunu yapıyor.
- Emsal: en popüler OSS proje yönetim aracı Plane de AGPL-3.0'ı seçti.
- AGPL, açık bir open-core yolunu mümkün kılıyor — bu modeli dışlamadan, ayrı lisanslı enterprise özelliklerin yanında bir AGPL community edition'ı.
- AGPL'i sonradan yeniden lisanslamak veya gevşetmek, kod tabanında kalan kodu olan her katkıda bulunandan onay gerektiriyor. Bu da onu fiilen tek yönlü bir kapı yapıyor, dolayısıyla sonradan "düzeltmek" yerine ilk günden doğru olması gerekiyor.

## Sonuçlar

- Kurul'un rakipler veya bulut sağlayıcıları tarafından kapalı kaynak olarak yeniden satılması, değişikliklerini yayınlamadan mümkün değil.
- Open-core yolu (AGPL çekirdek + proprietary enterprise eklentileri) bu iş modeli izlenirse gelecek için açık kalıyor.
- AGPL'in copyleft gücü, network-use maddesinden çekinen bazı enterprise benimseyicileri ve katkıda bulunanları caydırabilir — sağladığı korumaya karşı tartılan gerçek bir maliyet.
- AGPL community kodunu gelecekteki herhangi bir proprietary enterprise özellikle birleştirmek, proprietary kodu kirletmekten kaçınmak için dikkatli bir mimari ayrım (ve muhtemelen bir CLA) gerektiriyor.
- İleride yön değiştirmek, geçmişteki her katkıda bulunanı bulup onay almayı gerektiriyor — katkıda bulunan tabanı büyüdükçe pratikte neredeyse imkansıza yaklaşıyor.

## Değerlendirilen Alternatifler

| Alternatif                                | Neden değil                                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| MIT / Apache-2.0 (permissive)             | Katkıda bulunma zorunluluğu olmadan kapalı kaynak SaaS yeniden satışına izin veriyor — açık kaynak sürdürülebilirlik hedefini baltalıyor |
| Düz GPL-3.0                               | Network-use/SaaS boşluğunu açık bırakıyor — hosted bir fork kaynağını yayınlamak zorunda kalmazdı                                        |
| Proprietary / source-available (örn. BSL) | Daha ilk günden gerçek bir açık kaynak topluluk katkı modelini dışlıyor                                                                  |
