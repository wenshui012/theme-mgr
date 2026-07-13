(function (global) {
    var ns = global.ThemeMgrModules = global.ThemeMgrModules || {};

    ns.imageTools = {
        compressImage: function (dataUrl, cb, opts) {
            var maxWidth = opts && opts.maxWidth ? opts.maxWidth : 1200;
            var quality = opts && opts.quality ? opts.quality : 0.8;
            var img = new Image();
            img.onload = function () {
                var w = img.width, h = img.height, canvas = document.createElement('canvas');
                if (w > maxWidth) { canvas.width = maxWidth; canvas.height = Math.round(h * maxWidth / w); }
                else { canvas.width = w; canvas.height = h; }
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                cb(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = function () { cb(dataUrl); };
            img.src = dataUrl;
        },

        getDefaultCrop: function (imgW, imgH) {
            var target = 4 / 3;
            var cropW = imgW;
            var cropH = Math.round(cropW / target);
            if (cropH > imgH) {
                cropH = imgH;
                cropW = Math.round(cropH * target);
            }
            return {
                x: Math.max(0, Math.round((imgW - cropW) / 2)),
                y: Math.max(0, Math.round((imgH - cropH) / 2)),
                width: cropW,
                height: cropH,
                naturalWidth: imgW,
                naturalHeight: imgH,
                zoom: 1,
                posX: 50,
                posY: 50,
            };
        },

        makeThumbFromCrop: function (dataUrl, crop, cb, opts) {
            var quality = opts && opts.quality ? opts.quality : 0.8;
            var getDefaultCrop = ns.imageTools.getDefaultCrop;
            var img = new Image();
            img.onload = function () {
                var c = crop || getDefaultCrop(img.width, img.height);
                var canvas = document.createElement('canvas');
                canvas.width = 800;
                canvas.height = 600;
                var ctx = canvas.getContext('2d');
                var sx = Math.max(0, c.x || 0);
                var sy = Math.max(0, c.y || 0);
                var ex = Math.min(img.width, (c.x || 0) + (c.width || img.width));
                var ey = Math.min(img.height, (c.y || 0) + (c.height || img.height));
                var sw = Math.max(1, ex - sx);
                var sh = Math.max(1, ey - sy);
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
                cb(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = function () { cb(dataUrl); };
            img.src = dataUrl;
        },
    };
})(window);
