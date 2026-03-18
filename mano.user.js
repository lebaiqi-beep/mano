// ==UserScript==
// @name         ManoMano 商品采集工具
// @namespace    https://github.com/lebaiqi-beep/mano
// @version      5.2.1
// @description  提取 Mano 商品信息、下载首图、计算实际销售价格并导出CSV
// @match        *://www.manomano.fr/p/*
// @grant        GM_download
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/lebaiqi-beep/mano/main/mano.user.js
// @downloadURL  https://raw.githubusercontent.com/lebaiqi-beep/mano/main/mano.user.js
// ==/UserScript==

(function () {
    'use strict';

    const STORE_KEY = 'mano_data_store_v5';

    // =========================
    // 不采集的店铺名名单（可自行增加）
    // 例如：['GLORY', 'ABC SHOP', 'TEST']
    // =========================
    const BLOCKED_SHOPS = ['GLORY'];
    const BLOCKED_SHOPS = ['EMANOIL'];
    const BLOCKED_SHOPS = ['Zama'];
    const BLOCKED_SHOPS = ['LONGST'];

    function getStore() {
        try {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        } catch (e) {
            return [];
        }
    }

    function saveStore(data) {
        localStorage.setItem(STORE_KEY, JSON.stringify(data));
    }

    function cleanText(str) {
        if (!str) return '';
        return String(str)
            .replace(/\u00A0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function decodeHtml(str) {
        const txt = document.createElement('textarea');
        txt.innerHTML = str || '';
        return txt.value;
    }

    function matchFirst(text, regex) {
        const m = text.match(regex);
        return m ? m[1] : '';
    }

    function round2(n) {
        n = Number(n || 0);
        return Math.round(n * 100) / 100;
    }

    function normalizeShopName(name) {
        return cleanText(name).toUpperCase();
    }

    function isBlockedShop(shopName) {
        const current = normalizeShopName(shopName);
        return BLOCKED_SHOPS.map(normalizeShopName).includes(current);
    }

    function checkBlockedAndAlert(shopName) {
        if (isBlockedShop(shopName)) {
            alert('产品已上，请跳过。');
            updateStatus('命中跳过店铺：' + shopName);
            return true;
        }
        return false;
    }

    function extractTitle() {
        return cleanText(document.title || '');
    }

    function extractPrice() {
        const txt = document.body ? document.body.innerText : '';
        const m = txt.match(/(\d+,\d{2})\s*€/);
        return m ? m[1].replace(',', '.') : '';
    }

    function extractSeller() {
        const txt = document.body ? document.body.innerText : '';
        let m = txt.match(/Vendu par\s+([^\n\r]+)/i);
        if (m) return cleanText(m[1]);

        const html = document.documentElement ? document.documentElement.outerHTML : '';
        m = html.match(/Vendu par[\s\S]{0,100}?>([^<]+)</i);
        return m ? cleanText(m[1]) : '';
    }

    function extractDescription() {
        const el = document.querySelector('[data-testid="description-content"]');
        return el ? (el.innerHTML || '') : '';
    }

    function calcPrice(cost, weight, battery) {
        const C = Number(cost || 0);
        const D = Number(weight || 0);
        const M = 8;
        const N = 0.25;

        const J = (battery === '不带电')
            ? (C + D * 67 + 27)
            : (C + D * 90 + 27);

        // 最新利润率公式：
        // =IF(J<=70,0.3,IF(J>105,0.18,0.23))
        let L = 0.23;
        if (J <= 70) {
            L = 0.30;
        } else if (J > 105) {
            L = 0.18;
        }

        const K = (J / M) / (1 - L - N);
        return round2(K);
    }

    function extractImages(html) {
        const arr = [];
        const regex = /"largeUrl":"([^"]+)"/g;
        let m;

        while ((m = regex.exec(html)) !== null) {
            const url = decodeHtml(m[1])
                .replace(/\\u002F/g, '/')
                .replace(/\\\\/g, '\\')
                .replace(/\\"/g, '"');
            arr.push(url);
        }

        return [...new Set(arr.filter(Boolean))].slice(0, 6);
    }

    function buildRowFromPage() {
        const html = document.documentElement ? document.documentElement.outerHTML : '';

        const row = {
            SKU: '',
            EAN: '',
            Brand: '',
            mm_category_id: '',
            title: '',
            description: '',
            product_url_1: '',
            product_url_2: '',
            product_url_3: '',
            product_url_4: '',
            product_url_5: '',
            product_url_6: '',
            网址: location.href.split('#')[0],
            价格: '',
            店铺名: '',
            采购成本: '',
            重量: '',
            是否带电: '',
            实际销售价格: ''
        };

        const id = matchFirst(html, /"articleId":(\d+)/);
        if (id) row.SKU = 'MANO' + id;

        row.EAN = matchFirst(html, /"gtin":"([^"]+)"/);

        row.Brand =
            matchFirst(html, /"Brand","name":"([^"]+)"/) ||
            matchFirst(html, /"@type":"Brand","name":"([^"]+)"/) ||
            matchFirst(html, /"brand":\{[\s\S]{0,200}?"name":"([^"]+)"/);

        row.mm_category_id = matchFirst(html, /"category":"([^"]+)"/);
        row.title = extractTitle();
        row.description = extractDescription();

        const imgs = extractImages(html);
        imgs.forEach((u, i) => {
            row['product_url_' + (i + 1)] = u;
        });

        row.价格 = extractPrice();
        row.店铺名 = extractSeller();

        return row;
    }

    function mergeCurrentFormValues(row) {
        const cost = document.getElementById('cost')?.value || '';
        const weight = document.getElementById('weight')?.value || '';
        const battery = document.getElementById('battery')?.value || '不带电';

        row['采购成本'] = cost;
        row['重量'] = weight;
        row['是否带电'] = battery;

        if (cost !== '' && weight !== '') {
            row['实际销售价格'] = calcPrice(cost, weight, battery);
        } else {
            row['实际销售价格'] = '';
        }

        return row;
    }

    function collectCurrent() {
        let row = buildRowFromPage();

        // 命中禁止店铺则直接跳过
        if (checkBlockedAndAlert(row['店铺名'])) {
            return null;
        }

        row = mergeCurrentFormValues(row);

        const data = getStore();
        const idx = data.findIndex(x => x['网址'] === row['网址']);

        if (idx >= 0) {
            data[idx] = row;
        } else {
            data.push(row);
        }

        saveStore(data);
        updateStatus('已保存 ' + data.length + ' 条');
        refreshActualPrice();
        return row;
    }

    function exportCSV() {
        const data = getStore();
        if (!data.length) {
            alert('没有数据');
            return;
        }

        const headers = [
            'SKU', 'EAN', 'Brand', 'mm_category_id', 'title', 'description',
            'product_url_1', 'product_url_2', 'product_url_3', 'product_url_4', 'product_url_5', 'product_url_6',
            '网址', '价格', '店铺名',
            '采购成本', '重量', '是否带电', '实际销售价格'
        ];

        const rows = [headers.join(',')];

        data.forEach(r => {
            const row = headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`);
            rows.push(row.join(','));
        });

        const csv = '\uFEFF' + rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'manomano_export.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function downloadMainImageOnly() {
        const row = collectCurrent();
        if (!row) return; // 被禁止店铺时不继续下载

        const mainImage = row.product_url_1 || row.product_url_2 || '';
        const sku = row.SKU || 'MANO_IMAGE';

        if (!mainImage) {
            updateStatus('未找到首图，无法下载');
            return;
        }

        const extMatch = mainImage.match(/\.(jpg|jpeg|png|webp)(\?|$)/i);
        const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
        const fileName = sku.replace(/[\\/:*?"<>|]+/g, '_') + '.' + ext;

        try {
            GM_download({
                url: mainImage,
                name: fileName,
                saveAs: false,
                onload: function () {
                    updateStatus('首图已下载到下载文件夹');
                },
                onerror: function (e) {
                    console.log('GM_download 下载失败:', e);
                    updateStatus('首图下载失败');
                }
            });
        } catch (e) {
            console.log('GM_download 异常:', e);
            updateStatus('下载异常');
        }
    }

    function clearData() {
        if (!confirm('确定要清空所有已保存数据吗？')) return;
        localStorage.removeItem(STORE_KEY);
        updateStatus('数据已清空');
    }

    function refreshActualPrice() {
        const cost = document.getElementById('cost')?.value || '';
        const weight = document.getElementById('weight')?.value || '';
        const battery = document.getElementById('battery')?.value || '不带电';
        const out = document.getElementById('actual_price');

        if (!out) return;

        if (cost !== '' && weight !== '') {
            out.value = calcPrice(cost, weight, battery);
        } else {
            out.value = '';
        }
    }

    function updateStatus(t) {
        const el = document.getElementById('status');
        if (el) el.innerText = t;
    }

    function addPanel() {
        if (document.getElementById('mano-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'mano-panel';

        panel.style.position = 'fixed';
        panel.style.right = '20px';
        panel.style.bottom = '30px';
        panel.style.zIndex = '999999';
        panel.style.background = '#fff';
        panel.style.border = '2px solid #333';
        panel.style.padding = '10px';
        panel.style.minWidth = '240px';
        panel.style.fontSize = '14px';
        panel.style.lineHeight = '1.5';

        panel.innerHTML = `
            <div style="font-weight:bold;margin-bottom:6px;">MANO采集工具</div>
            <div id="status" style="font-size:12px;margin-bottom:8px;">等待操作</div>

            <div>采购成本</div>
            <input id="cost" type="number" step="any" style="width:100%;box-sizing:border-box;">

            <div style="margin-top:6px;">重量</div>
            <input id="weight" type="number" step="any" style="width:100%;box-sizing:border-box;">

            <div style="margin-top:6px;">是否带电</div>
            <select id="battery" style="width:100%;box-sizing:border-box;">
                <option value="不带电">不带电</option>
                <option value="带电">带电</option>
            </select>

            <div style="margin-top:6px;">实际销售价格</div>
            <input id="actual_price" type="text" readonly style="width:100%;box-sizing:border-box;background:#f3f3f3;">

            <button id="collect" style="display:block;width:100%;margin-top:8px;">提取当前页</button>
            <button id="download_main" style="display:block;width:100%;margin-top:8px;">下载主图</button>
            <button id="export" style="display:block;width:100%;margin-top:8px;">导出CSV</button>
            <button id="clear" style="display:block;width:100%;margin-top:8px;">清空数据</button>
        `;

        document.body.appendChild(panel);

        document.getElementById('collect').onclick = collectCurrent;
        document.getElementById('download_main').onclick = downloadMainImageOnly;
        document.getElementById('export').onclick = exportCSV;
        document.getElementById('clear').onclick = clearData;

        document.getElementById('cost').addEventListener('input', refreshActualPrice);
        document.getElementById('weight').addEventListener('input', refreshActualPrice);
        document.getElementById('battery').addEventListener('change', refreshActualPrice);

        refreshActualPrice();
    }

    addPanel();

})();
