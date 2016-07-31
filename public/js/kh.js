/*
Copyright Alex Leone, David Nufer, David Truong, 2011-03-11. kathack.com

javascript:var i,s,ss=['http://kathack.com/js/kh.js','http://ajax.googleapis.com/ajax/libs/jquery/1.5.1/jquery.min.js'];for(i=0;i!=ss.length;i++){s=document.createElement('script');s.src=ss[i];document.body.appendChild(s);}void(0);

*/
var BORDER_STYLE = "1px solid #bbb",
    CSS_TRANSFORM = null,
    CSS_TRANSFORM_ORIGIN = null,
    POSSIBLE_TRANSFORM_PREFIXES = ['-webkit-', '-moz-', '-o-', '-ms-', ''],
    khFirst = false;

/* When running twice on one page, update pick-uppable nodes instead of
 * creating more.
 */
if (!window.khNodes) {
    khFirst = true;
    window.khNodes = new StickyNodes();
}

function getCssTransform() {
    var i, d = document.createElement('div'), pre;
    for (i = 0; i < POSSIBLE_TRANSFORM_PREFIXES.length; i++) {
        pre = POSSIBLE_TRANSFORM_PREFIXES[i];
        d.style.setProperty(pre + 'transform', 'rotate(1rad) scaleX(2)', null);
        if (d.style.getPropertyValue(pre + 'transform')) {
            CSS_TRANSFORM = pre + 'transform';
            CSS_TRANSFORM_ORIGIN = pre + 'transform-origin';
            return;
        }
    }
    alert("Your browser doesn't support CSS tranforms!");
    throw "Your browser doesn't support CSS tranforms!";
}
getCssTransform();

/**
 * Returns true if the circle intersects the element rectangle.
 * 0  |   1   |   2
 * ------------------
 * 3  |   4   |   5
 * ------------------
 * 6  |   7   |   9
 */
function circleGridObjInt(cx, cy, cr, cr2, go) {
    var dx, dy;
    if (cx < go.left) {
        dx = go.left - cx;
        if (cy < go.top) { /* zone 0. */
            dy = go.top - cy;
            return ((dx * dx + dy * dy) <= cr2);
        } else if (cy <= go.bottom) { /* zone 3. */
            return (dx <= cr);
        } else { /* zone 6. */
            dy = cy - go.bottom;
            return ((dx * dx + dy * dy) <= cr2);
        }
    } else if (cx <= go.right) {
        if (cy < go.top) { /* zone 1. */
            return ((go.top - cy) <= cr);
        } else if (cy <= go.bottom) { /* zone 4. */
            return true;
        } else { /* zone 7. */
            return ((cy - go.bottom) <= cr);
        }
    } else {
        dx = cx - go.right;
        if (cy < go.top) { /* zone 2. */
            dy = go.top - cy;
            return ((dx * dx + dy * dy) <= cr2);
        } else if (cy <= go.bottom) { /* zone 5. */
            return (dx <= cr);
        } else { /* zone 9. */
            dy = cy - go.bottom;
            return ((dx * dx + dy * dy) <= cr2);
        }
    }
}

/**
 * Returns [x,y] where the rectangle is closest to (cx, cy).
 * 0  |   1   |   2
 * ------------------
 * 3  |   4   |   5
 * ------------------
 * 6  |   7   |   9
 */
function getClosestPoint(cx, cy, go) {
    var dx, dy;
    if (cx < go.left) {
        dx = go.left - cx;
        if (cy < go.top) { /* zone 0. */
            return [go.left, go.top];
        } else if (cy <= go.bottom) { /* zone 3. */
            return [go.left, cy];
        } else { /* zone 6. */
            return [go.left, go.bottom];
        }
    } else if (cx <= go.right) {
        if (cy < go.top) { /* zone 1. */
            return [cx, go.top];
        } else if (cy <= go.bottom) { /* zone 4. */
            return [cx, cy];
        } else { /* zone 7. */
            return [cx, go.bottom];
        }
    } else {
        dx = cx - go.right;
        if (cy < go.top) { /* zone 2. */
            return [go.right, go.top];
        } else if (cy <= go.bottom) { /* zone 5. */
            return [go.right, cy];
        } else { /* zone 9. */
            return [go.right, go.bottom];
        }
    }
}

/**
 * Returns the "volume" of the grid object.
 */
function gridObjVol(go) {
    return go.w * go.h * Math.min(go.w, go.h);
}

function StickyNodes() {
    var domNodes = [],
        grid = [],
        GRIDX = 100,
        GRIDY = 100,
        REPLACE_WORDS_IN = {
            a: 1, b: 1, big: 1, body: 1, cite:1, code: 1, dd: 1, div: 1,
            dt: 1, em: 1, font: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
            i: 1, label: 1, legend: 1, li: 1, p: 1, pre: 1, small: 1,
            span: 1, strong: 1, sub: 1, sup: 1, td: 1, th: 1, tt: 1
        };

    function addDomNode(el) {
        if (el !== undefined && el !== null) {
            el.khIgnore = true;
            el.style.border = BORDER_STYLE;
            domNodes.push(el);
        }
    }
    this.addDomNode = addDomNode;

    this.addWords = function (el) {
        var textEls = [];
        
        function shouldAddChildren(el) {
            return el.tagName && REPLACE_WORDS_IN[el.tagName.toLowerCase()];
        }
        
        function buildTextEls(el, shouldAdd) {
            var i, len;
            if (shouldAdd && el.nodeType === Node.TEXT_NODE &&
                    el.nodeValue.trim().length > 0) {
                textEls.push(el);
                return;
            }
            if (!el.childNodes || el.khIgnore) {
                return;
            }
            shouldAdd = shouldAddChildren(el);
            for (i = 0, len = el.childNodes.length; i < len; i++) {
                buildTextEls(el.childNodes[i], shouldAdd);
            }
        }
        
        function wordsToSpans(textEl) {
            var p = textEl.parentNode,
                words = textEl.nodeValue.split(/\s+/),
                ws = textEl.nodeValue.split(/\S+/),
                i, n, len = Math.max(words.length, ws.length);
            /* preserve whitespace for pre tags. */
            if (ws.length > 0 && ws[0].length === 0) {
                ws.shift();
            }
            for (i = 0; i < len; i++) {
                if (i < words.length && words[i].length > 0) {
                    n = document.createElement('span');
                    n.innerHTML = words[i];
                    p.insertBefore(n, textEl);
                    addDomNode(n);
                }
                if (i < ws.length && ws[i].length > 0) {
                    n = document.createTextNode(ws[i]);
                    p.insertBefore(n, textEl);
                }
            }
            p.removeChild(textEl);
        }
        
        buildTextEls(el, shouldAddChildren(el));
        textEls.map(wordsToSpans);
    };
    
    /* includes el. */
    this.addTagNames = function (el, tagNames) {
        var tname = el.tagName && el.tagName.toLowerCase(),
            i, j, els, len;
        if (el.khIgnore) {
            return;
        }
        if (tagNames.indexOf(tname) !== -1) {
            addDomNode(el);
        }
        if (!el.getElementsByTagName) {
            return;
        }
        for (i = 0; i < tagNames.length; i++) {
            els = el.getElementsByTagName(tagNames[i]);
            for (j = 0, len = els.length; j < len; j++) {
                if (!els[j].khIgnore) {
                    addDomNode(els[j]);
                }
            }
        }
    };
    
    this.finalize = function (docW, docH) {
        var xi, yi, i, len, startXI, startYI, el, go, off, w, h,
            endXI = Math.floor(docW / GRIDX) + 1,
            endYI = Math.floor(docH / GRIDY) + 1;
        /* initialize grid. */
        grid = new Array(endXI);
        for (xi = 0; xi < endXI; xi++) {
            grid[xi] = new Array(endYI);
        }
        /* add nodes into grid. */
        for (i = 0, len = domNodes.length; i < len; i++) {
            el = domNodes[i];
            if (el.khPicked) {
                continue;
            }
            off = jQuery(el).offset();
            w = jQuery(el).width();
            h = jQuery(el).height();
            go = {
                el: domNodes[i], /* dom element. */
                left: off.left,
                right: off.left + w,
                top: off.top,
                bottom: off.top + h,
                w: w,
                h: h,
                x: off.left + (w / 2),    /* center x. */
                y: off.top + (h / 2),    /* center y. */
                diag: Math.sqrt(((w * w) + (h * h)) / 4), /* center to corner */
               
                /* these are for removing ourselves from the grid. */
                arrs: [], /* which arrays we're in (grid[x][y]). */
                idxs: []  /* what indexes. */
            };
            startXI = Math.floor(go.left / GRIDX);
            startYI = Math.floor(go.top / GRIDY);
            endXI = Math.floor((go.left + go.w) / GRIDX) + 1;
            endYI = Math.floor((go.top + go.h) / GRIDY) + 1;
            for (xi = startXI; xi < endXI; xi++) {
                for (yi = startYI; yi < endYI; yi++) {
                    if (grid[xi] === undefined) {
                        grid[xi] = [];
                    }
                    if (grid[xi][yi] === undefined) {
                        grid[xi][yi] = [go];
                    } else {
                        grid[xi][yi].push(go);
                    }
                    go.arrs.push(grid[xi][yi]);
                    go.idxs.push(grid[xi][yi].length - 1);
                }
            }
        }
    };
    
    function removeGridObj(go) {
        var i;
        for (i = 0; i < go.arrs.length; i++) {
            go.arrs[i][go.idxs[i]] = undefined;
        }
        go.el.style.visibility = "hidden";
        go.el.khPicked = true;
        delete go.arrs;
        delete go.idxs;
    }
    
    /**
     * cb(gridObj) -> boolean true if the object should be removed.
     */
    this.removeIntersecting = function (x, y, r, cb) {
        var xi, yi, arr, i, r2 = r * r, go,
            startXI = Math.floor((x - r) / GRIDX),
            startYI = Math.floor((y - r) / GRIDY),
            endXI = Math.floor((x + r) / GRIDX) + 1,
            endYI = Math.floor((y + r) / GRIDY) + 1;
        for (xi = startXI; xi < endXI; xi++) {
            if (grid[xi] === undefined) {
                continue;
            }
            for (yi = startYI; yi < endYI; yi++) {
                arr = grid[xi][yi];
                if (arr === undefined) {
                    continue;
                }
                for (i = 0; i < arr.length; i++) {
                    go = arr[i];
                    if (go !== undefined &&
                            circleGridObjInt(x, y, r, r2, go) &&
                            cb(go)) {
                        removeGridObj(go);
                    }
                }
            }
        }
    };
}

function PlayerBall(parentNode, stickyNodes, ballOpts, sounds) {
    var x = 300, y = 300,
        vx = 0, vy = 0,
        radius = 20,
        lastR = 0, /**< optimization: only resize when necessary. */
        docW = 10000, docH = 10000,
        
        attached = [],
        attachedDiv, /* div to put attached nodes into. */
        canvas_el,
        canvas_ctx,
        color = ballOpts.color,
        
        accelTargetX = 0, accelTargetY = 0,
        accel = false,
        
        VOL_MULT = ballOpts.VOL_MULT,
        MAX_ATTACHED_VISIBLE = ballOpts.MAX_ATTACHED_VISIBLE,
        CHECK_VOLS = ballOpts.CHECK_VOLS,

        /**
         * which direction the ball is facing in the xy axis, in radians.
         * th: 0 is facing dead East
         * th: 1/2 PI is facing dead South
         * note that this is like regular th on a graph with y inverted.
         * Same rotation as css transform.
         */
        th = 0,
        
        /**
         * Ball angle in the rotation axis / z plane, in radians.
         * phi: 0 is pointing in the direction the ball is rolling.
         * phi: 1/2 PI is pointing straight up (out of the page).
         * note that forward rotation means phi -= 0.1.
         */
        phi = 0;
        
    this.init = function () {
        canvas_el = document.createElement('canvas');
        canvas_el.width = radius * 2;
        canvas_el.height = radius * 2;
        canvas_el.style.cssText = 'position: absolute; z-index: 500;';
        parentNode.appendChild(canvas_el);
        canvas_ctx = canvas_el.getContext('2d');
        
        attachedDiv = document.createElement('div');
        parentNode.appendChild(attachedDiv);
    };
    
    this.setRadius = function (r) {
        radius = r;
    };
    
    this.getState = function () {
        return {
            x: x,
            y: y,
            vx: vx,
            vy: vy,
            radius: radius,
            th: th,
            phi: phi,
        };
    };
    
    this.setState = function (s) {
        x = s.x;
        y = s.y;
        vx = s.vx;
        vy = s.vy;
        radius = s.radius;
        th = s.th;
        phi = s.phi;
    };
        
    this.setXY = function (sx, sy) {
        x = sx;
        y = sy;
    };
    
    this.setTh = function (sth) {
        th = sth;
    };
    
    this.setPhi = function (sphi) {
        phi = sphi;
    };

    this.setColor = function (c) {
        color = c;
    };
    
    this.setDocSize = function (w, h) {
        docW = w;
        docH = h;
    };
    
    this.setAccel = function (bool) {
        accel = bool;
    };
    
    this.setAccelTarget = function (tx, ty) {
        accelTargetX = tx;
        accelTargetY = ty;
    };
    
    function getVol() {
        return (4 * Math.PI * radius * radius * radius / 3);
    }

    function grow(go) {
        var newVol = getVol() + gridObjVol(go) * VOL_MULT;
        radius = Math.pow(newVol * 3 / (4 * Math.PI), 1 / 3);
    }
    
    function attachGridObj(go) {
        var attXY = getClosestPoint(x, y, go),
            dx = attXY[0] - x,
            dy = attXY[1] - y,
            r = Math.sqrt(dx * dx + dy * dy),
            attTh = 0 - th,
            offLeft = attXY[0] - go.left,
            offTop = attXY[1] - go.top,
            offTh = Math.atan2(dy, dx) - th,
            attX = r * Math.cos(offTh),
            attY = r * Math.sin(offTh),
            el = go.el.cloneNode(true),
            go_jel = jQuery(go.el),
            newAtt = {
                el: el,
                attX: attX,
                attY: attY,
                attT: 'translate(' + Math.round(attX) + 'px,' +
                                     Math.round(attY) + 'px) ' +
                      'rotate(' + attTh + 'rad)',
                r: r,
                offTh: offTh,
                offPhi: 0 - phi,
                diag: go.diag,
                removeR: r + go.diag,
                visible: false,
                display: go_jel.css('display')
            };
        attached.push(newAtt);
        grow(go);
        el.style.position = 'absolute';
        el.style.left = (-offLeft) + 'px';
        el.style.top = (-offTop) + 'px';
        el.style.setProperty(CSS_TRANSFORM_ORIGIN,
                             offLeft + 'px ' + offTop + 'px', null);
        el.style.display = 'none';
        /* copy computed styles from old object. */
        el.style.color = go_jel.css('color');
        el.style.textDecoration = go_jel.css('text-decoration');
        el.style.fontSize = go_jel.css('font-size');
        el.style.fontWeight = go_jel.css('font-weight');
        el.khIgnore = true;
        attachedDiv.appendChild(el);
        if (sounds) {
            sounds.play_pop();
        }
    }
    
    /**
     * @return true if the object should be removed from stickyNodes.
     */
    function removeIntCb(go) {
        if (CHECK_VOLS && gridObjVol(go) > getVol()) {
            return false;
        }
        attachGridObj(go);
        return true;
    }
    
    this.updatePhysics = function () {
        var oldX = x, oldY = y, dx, dy,
            bounce = false,
            accelTh;
        if (accel) {
            accelTh = Math.atan2(accelTargetY - y, accelTargetX - x);
            vx += Math.cos(accelTh) * 0.5;
            vy += Math.sin(accelTh) * 0.5;
        } else {
            vx *= 0.95;
            vy *= 0.95;
        }
        x += vx;
        y += vy;
        /* bounce ball on edges of document. */
        if (x - radius < 0) {
            bounce = true;
            x = radius + 1;
            vx = -vx;
        } else if (x + radius > docW) {
            bounce = true;
            x = docW - radius - 1;
            vx = -vx;
        }
        if (y - radius < 0) {
            bounce = true;
            y = radius + 1;
            vy = -vy;
        } else if (y + radius > docH) {
            bounce = true;
            y = docH - radius - 1;
            vy = -vy;
        }
        if (vx !== 0 || vy !== 0) {
            th = Math.atan2(vy, vx);
            dx = x - oldX;
            dy = y - oldY;
            /* arclen = th * r,    so   th = arclen / r. */
            phi -= Math.sqrt(dx * dx + dy * dy) / radius;
        }
        stickyNodes.removeIntersecting(x, y, radius, removeIntCb);
        this.draw();
        if (bounce && sounds) {
            sounds.play_bounce();
        }
    };
    
    function drawBall() {
        var sx1, sy1, sx2, sy2, dx, dy, i, pct1, pct2, z1, z2;
        /* move/resize canvas element. */
        canvas_el.style.left = (x - radius) + 'px';
        canvas_el.style.top = (y - radius) + 'px';
        if (radius != lastR) {
            canvas_el.width = 2 * radius + 1;
            canvas_el.height = 2 * radius + 1;
            lastR = radius;
        }
        /* draw white circle. */
        canvas_ctx.clearRect(0, 0, 2 * radius, 2 * radius);
        canvas_ctx.fillStyle = "#fff";
        canvas_ctx.beginPath();
        canvas_ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2, true);
        canvas_ctx.fill();
        /* draw outer border. */
        canvas_ctx.strokeStyle = color;
        canvas_ctx.beginPath();
        canvas_ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2, true);
        canvas_ctx.stroke();
        /* draw stripes. */
        canvas_ctx.fillStyle = color;
        sx1 = radius + radius * Math.cos(th + Math.PI / 16);
        sy1 = radius + radius * Math.sin(th + Math.PI / 16);
        sx2 = radius + radius * Math.cos(th - Math.PI / 16);
        sy2 = radius + radius * Math.sin(th - Math.PI / 16);
        dx = (radius + radius * Math.cos(th + Math.PI * 15 / 16)) - sx1;
        dy = (radius + radius * Math.sin(th + Math.PI * 15 / 16)) - sy1;
        for (i = 0; i < Math.PI * 2; i += Math.PI / 7) {
            pct1 = (-Math.cos(phi + i) + 1) / 2;
            pct2 = (-Math.cos(phi + i + Math.PI / 32) + 1) / 2;
            z1 = Math.sin(phi + i);
            z2 = Math.sin(phi + i + Math.PI / 32);
            if (z1 > 0 && z2 > 0) {
                canvas_ctx.beginPath();
                canvas_ctx.moveTo(sx1 + pct1 * dx, sy1 + pct1 * dy);
                canvas_ctx.lineTo(sx1 + pct2 * dx, sy1 + pct2 * dy);
                canvas_ctx.lineTo(sx2 + pct2 * dx, sy2 + pct2 * dy);
                canvas_ctx.lineTo(sx2 + pct1 * dx, sy2 + pct1 * dy);
                canvas_ctx.fill();
            }
        }
    }
    
    /**
     * @return true if the attached object is roughly visible.
     */
    function drawAttached(att) {
        var oth = th + att.offTh,
            ophi = phi + att.offPhi,
            ox = att.r * Math.cos(oth),
            oy = att.r * Math.sin(oth),
            dx = (att.r * Math.cos((th - att.offTh) + Math.PI)) - ox,
            dy = (att.r * Math.sin((th - att.offTh) + Math.PI)) - oy,
            pct = (-Math.cos(ophi) + 1) / 2,
            cx = ox + pct * dx,
            cy = oy + pct * dy,
            oz = att.r * Math.sin(ophi);
        if (oz < 0 && Math.sqrt(cx * cx + cy * cy) + att.diag < radius) {
            /* hidden behind circle. */
            if (att.visible) {
                att.visible = false;
                att.el.style.display = "none";
            }
            return false;
        }
        /* attached node is visible. */
        if (!att.visible) {
            att.visible = true;
            att.el.style.display = att.display;
        }
        //att.el.style.zIndex = 500 + Math.round(oz);
        att.el.style.zIndex = (oz > 0)? 501 : 499;
        att.el.style.setProperty(
            CSS_TRANSFORM,
            'translate(' + x + 'px,' + y + 'px) ' +
            'rotate(' + th + 'rad) ' +
            'scaleX(' + Math.cos(ophi) + ') ' +
            att.attT, null);
        return true;
    }
    
    function onAttachedRemoved(att) {
        attachedDiv.removeChild(att.el);
        delete att.el;
    }
    
    this.draw = function () {
        var i, att, numAttachedVisible = 0;
        drawBall();
        for (i = attached.length; --i >= 0;) {
            att = attached[i];
            if (att.removeR < radius) {
                attached.splice(i, 1).map(onAttachedRemoved);
            } else if (drawAttached(att)) {
                if (++numAttachedVisible > MAX_ATTACHED_VISIBLE) {
                    /* remove older items and stop. */
                    attached.splice(0, i).map(onAttachedRemoved);
                    break;
                }
            }
        }
    };
}

function preventDefault(event) {
    event.preventDefault();
    event.returnValue = false;
    return false;
}

function Game(gameDiv, stickyNodes, ballOpts) {
    var stickyNodes, player1, physicsInterval, resizeInterval, listeners = [];
    player1 = new PlayerBall(gameDiv, stickyNodes, ballOpts, false);
    player1.init();
    player1.setXY(300, 300);
    window.scrollTo(0, 200);
    
    function on_resize() {
        player1.setDocSize(jQuery(document).width() - 5,
                           jQuery(document).height() - 5);
    }
    on_resize();

    /* touch events - always on? */
    document.addEventListener('touchstart', function (event) {
        if (event.touches.length === 1) {
            player1.setAccel(true);
            return preventDefault(event);
        }
    }, true);
    document.addEventListener('touchmove', function (event) {
        player1.setAccelTarget(event.touches[0].pageX,
                               event.touches[0].pageY);
    }, true);
    document.addEventListener('touchend', function (event) {
        if (event.touches.length === 0) {
            player1.setAccel(false);
            return preventDefault(event);
        }
    }, true);
    
    if (ballOpts.MOUSEB !== -5) {
        /* mouse buttons */
        document.addEventListener('mousemove', function (event) {
            player1.setAccelTarget(event.pageX, event.pageY);
        }, true);
        document.addEventListener('mousedown', function (event) {
            if (event.button === ballOpts.MOUSEB) {
                player1.setAccel(true);
                return preventDefault(event);
            }
        }, true);
        document.addEventListener('mouseup', function (event) {
            if (event.button === ballOpts.MOUSEB) {
                player1.setAccel(false);
                return preventDefault(event);
            }
        }, true);

        if (ballOpts.MOUSEB === 0) {
            /* block click events. */
           document.addEventListener('click', function (event) {
                if (event.button === 0) {
                    return preventDefault(event);
                }
            }, true);
        } else if (ballOpts.MOUSEB === 2) {
            /* block right-click context menu. */
            document.addEventListener('contextmenu', preventDefault, true);
        }
    }

    physicsInterval = setInterval(function () {
        player1.updatePhysics();
    }, 25);
    resizeInterval = setInterval(on_resize, 1000);
}

function whenAllLoaded(gameDiv, popup, stickyNodes) {
    stickyNodes.finalize(jQuery(document).width(), jQuery(document).height());
    jQuery('#loadingp').empty();
    jQuery('<button>Start!</button>').click(function () {
        var game, bgmusic, ballOpts;
        if (jQuery('#bgmusicc').attr('checked')) {
            if (!(bgmusic = document.getElementById('khbgmusic'))) {
                bgmusic = document.createElement('audio');
                bgmusic.id = 'khbgmusic';
                bgmusic.loop = 'loop';
                bgmusic.src = 'http://kathack.com/js/katamari.mp3';
                gameDiv.appendChild(bgmusic);
            }
            bgmusic.play();
        }
        ballOpts = {
            color: jQuery('#khcolor').val(),
            VOL_MULT: parseFloat(jQuery('#vol_mult').val()),
            MAX_ATTACHED_VISIBLE: parseInt(jQuery('#maxAtt').val(), 10),
            CHECK_VOLS: (jQuery('#checkv').attr('checked'))? true : false,
            MOUSEB: parseInt(jQuery('#mouseb').val(), 10)
        };
        gameDiv.removeChild(popup);
        game = new Game(gameDiv, stickyNodes, ballOpts);
    }).appendTo('#loadingp');
}

function buildPopup(gameDiv) {
    var d = document.createElement('div'), b;
    d.style.cssText = '\
position: fixed;\
left: 50%;\
top: 50%;\
width: 400px;\
margin-left:-200px;\
margin-top:-150px;\
border:1px solid black;\
background-color:white;\
color:black;\
padding:20px;\
font-size:13px;\
text-align:left;\
z-index:501;';
    d.innerHTML = '<h1 style="font-size:16pt">\
<a href="http://kathack.com/" style="color:blue;text-decoration:none;">\
Katamari!</a></h1>\
<button style="position:absolute;top:0;right:0;">X</button>\
<p>Controls: Hold down <b><select id="mouseb">\
<option value="0">Left-Click</option>\
<option value="2" selected="selected">Right-Click</option>\
<option value="-5">Touch</option>\
</select></b> to control the ball!</p>\
<div><label>Background Music? \
<input id="bgmusicc" type="checkbox" checked="checked" /></label></div>\
<div style="text-align:right; color:gray;">\
<label>Katamari Color: <select id="khcolor">\
<option value="#ff0000" style="background-color:#ff0000;color:#ff0000"> r </option>\
<option value="#00ff00" style="background-color:#00ff00;color:#00ff00"> g </option>\
<option value="#0000ff" style="background-color:#0000ff;color:#0000ff"> b </option>\
<option selected="selected" value="#7D26CD" style="background-color:#7D26CD;color:#7D26CD"> p \
</option></select></label><br />\
 <label title="Lower this if the game gets slow.">\
Max Attached Objects: <select id="maxAtt">\
<option>25</option>\
<option>50</option>\
<option selected="selected">75</option>\
<option>100</option>\
<option>9000</option></select></label><br />\
<label title="How much to grow when an object is picked up.">\
Growth Speed: <input id="vol_mult" type="text" size="6" value="1.0" />\
</label><br />\
<label title="Bigger objects require a bigger katamari to pick up.">\
Realistic Pickups? <input id="checkv" type="checkbox" checked="checked" />\
</label></div>\
<p id="loadingp">Loading!</p>';
    gameDiv.appendChild(d);
    d.getElementsByTagName('button')[0].addEventListener('click', function () {
        gameDiv.removeChild(d);
    }, true);
    return d;
}

function main() {
    var gameDiv, checkInterval, stickyNodes, popup;
    
    gameDiv = document.createElement('div');
    gameDiv.khIgnore = true;
    document.body.appendChild(gameDiv);
    popup = buildPopup(gameDiv);
    
    /* setTimeout so that the popup displays before we freeze. */
    setTimeout(function () {
        var i, len, el;
        window.khNodes.addWords(document.body);
        for (i = 0, len = document.body.childNodes.length; i < len; i++) {
            el = document.body.childNodes[i];
            window.khNodes.addTagNames(el, [
                'button', 'canvas', 'iframe', 'img', 'input', 'select',
                'textarea'
            ]);
        }

        checkInterval = setInterval(function () {
            if (window.jQuery) {
                clearInterval(checkInterval);
                whenAllLoaded(gameDiv, popup, window.khNodes);
            }
        }, 100);
    }, 0);
}

if (!window.noMain) {
    main();
}

