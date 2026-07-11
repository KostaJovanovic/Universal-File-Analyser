/* Analyser - Asteroids easter egg: the overlay's scoped stylesheet.
   gameCss(t) returns the CSS text injected into the game overlay, parameterised by
   the live theme tokens `t` (pulled from the site's CSS vars at launch). Buttons
   mirror .anr-btn (dark/fullscreen variant): square corners, hairline border, invert
   on hover, accent on press. Done as real CSS (not inline) so :hover/:active work
   like the site. */

import { MONO } from './config.js';

export function gameCss(t) {
  const { ACCENT, ACCENT_FG, MEDIA_BG, SURFACE, ON_DARK, BORDER, MUTED } = t;
  return '.anr-game-btn{font-family:' + MONO + ';font-weight:500;letter-spacing:.01em;background:' + SURFACE +
    ';color:' + ON_DARK + ';border:1px solid ' + BORDER + ';border-radius:0;cursor:pointer;' +
    'transition:background .12s ease,color .12s ease,border-color .12s ease;}' +
    '.anr-game-btn:hover{background:' + ON_DARK + ';color:' + MEDIA_BG + ';}' +
    '.anr-game-btn:active{background:' + ACCENT + ';color:' + ACCENT_FG + ';border-color:' + ACCENT + ';}' +
    // End-of-game leaderboard panel: name entry, then the top 5 + play again.
    '.anr-score-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:4;' +
    'display:flex;flex-direction:column;align-items:center;gap:9px;width:min(320px,86vw);' +
    'padding:20px 22px;background:' + MEDIA_BG + ';border:1px solid ' + BORDER + ';' +
    'font-family:' + MONO + ';color:' + ON_DARK + ';text-align:center;}' +
    '.anr-score-title{font-size:13px;letter-spacing:.18em;color:' + MUTED + ';}' +
    '.anr-score-go{font-size:24px;color:' + ACCENT + ';letter-spacing:.04em;}' +
    '.anr-score-sub{font-size:13px;color:' + ON_DARK + ';}' +
    '.anr-score-msg{font-size:12px;color:' + MUTED + ';min-height:14px;}' +
    '.anr-score-msg.err{color:' + ACCENT + ';}' +
    '.anr-score-input{font-family:' + MONO + ';font-size:24px;letter-spacing:.45em;text-align:center;' +
    'text-transform:uppercase;width:170px;padding:9px 4px 9px 16px;background:' + SURFACE + ';color:' + ON_DARK +
    ';border:1px solid ' + BORDER + ';border-radius:0;outline:none;caret-color:' + ACCENT + ';}' +
    '.anr-score-input:focus{border-color:' + ON_DARK + ';}' +
    '.anr-score-row{display:flex;gap:8px;}' +
    '.anr-score-list{list-style:none;margin:2px 0 4px;padding:0;width:100%;font-size:13px;}' +
    '.anr-score-list li{display:flex;align-items:center;padding:4px 2px;border-bottom:1px solid ' + BORDER + ';}' +
    '.anr-score-list li:last-child{border-bottom:0;}' +
    '.anr-score-list li .r{color:' + MUTED + ';width:1.6em;text-align:right;}' +
    '.anr-score-list li .n{flex:1;text-align:left;padding-left:12px;letter-spacing:.18em;}' +
    '.anr-score-list li .s{color:' + ACCENT + ';font-weight:600;}' +
    '.anr-score-list li.me .n{color:' + ACCENT + ';}' +
    // Fancy splash / pause / settings menus: stat chips, full-width buttons, toggle switches.
    '.anr-menu-rule{width:100%;height:1px;background:' + BORDER + ';margin:3px 0;}' +
    '.anr-menu-chips{display:flex;gap:8px;width:100%;}' +
    '.anr-menu-chip{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;' +
    'padding:8px 4px;background:' + SURFACE + ';border:1px solid ' + BORDER + ';}' +
    '.anr-menu-chip .k{font-size:9px;letter-spacing:.14em;color:' + MUTED + ';}' +
    '.anr-menu-chip .v{font-size:16px;color:' + ON_DARK + ';}' +
    '.anr-menu-chip .v.acc{color:' + ACCENT + ';}' +
    '.anr-menu-btn{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;' +
    'font-family:' + MONO + ';font-size:14px;font-weight:500;letter-spacing:.02em;text-align:left;' +
    'padding:11px 15px;background:' + SURFACE + ';color:' + ON_DARK + ';border:1px solid ' + BORDER +
    ';border-radius:0;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease;}' +
    '.anr-menu-btn:hover{background:' + ON_DARK + ';color:' + MEDIA_BG + ';border-color:' + ON_DARK + ';}' +
    '.anr-menu-btn .ic{flex:none;width:18px;text-align:center;font-size:15px;opacity:.9;}' +
    '.anr-menu-btn--primary{background:' + ACCENT + ';color:' + ACCENT_FG + ';border-color:' + ACCENT + ';}' +
    '.anr-menu-btn--primary:hover{background:' + ON_DARK + ';color:' + MEDIA_BG + ';border-color:' + ON_DARK + ';}' +
    '.anr-menu-toggle{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;' +
    'box-sizing:border-box;background:none;border:0;border-bottom:1px solid ' + BORDER + ';padding:10px 2px;' +
    'cursor:pointer;font-family:' + MONO + ';}' +
    '.anr-menu-toggle:last-of-type{border-bottom:0;}' +
    '.anr-menu-toggle .lab{display:flex;flex-direction:column;gap:2px;text-align:left;}' +
    '.anr-menu-toggle .lab .t{font-size:13px;color:' + ON_DARK + ';}' +
    '.anr-menu-toggle .lab .d{font-size:10px;color:' + MUTED + ';letter-spacing:.01em;}' +
    '.anr-menu-sw{flex:none;width:42px;height:22px;position:relative;background:' + SURFACE +
    ';border:1px solid ' + BORDER + ';transition:background .14s ease,border-color .14s ease;}' +
    '.anr-menu-sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;background:' + MUTED +
    ';transition:transform .14s ease,background .14s ease;}' +
    '.anr-menu-sw.on{background:' + ACCENT + ';border-color:' + ACCENT + ';}' +
    '.anr-menu-sw.on::after{transform:translateX(20px);background:' + ACCENT_FG + ';}' +
    '.anr-menu-seg{flex:none;display:flex;border:1px solid ' + BORDER + ';}' +
    '.anr-menu-seg button{flex:none;font-family:' + MONO + ';font-size:11px;padding:5px 9px;background:' + SURFACE +
    ';color:' + ON_DARK + ';border:0;border-left:1px solid ' + BORDER + ';cursor:pointer;' +
    'transition:background .12s ease,color .12s ease;}' +
    '.anr-menu-seg button:first-child{border-left:0;}' +
    '.anr-menu-seg button:hover{background:' + ON_DARK + ';color:' + MEDIA_BG + ';}' +
    '.anr-menu-seg button.on{background:' + ACCENT + ';color:' + ACCENT_FG + ';}' +
    '.anr-game-btn.on{background:' + ACCENT + ';color:' + ACCENT_FG + ';border-color:' + ACCENT + ';}';
}
