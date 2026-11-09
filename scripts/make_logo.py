# Draws the StatSniper logo (owner design, traced to SVG) and writes logo.svg, logo_mark.svg,
# logo_maskable.svg and logo_header.svg in the current folder. App icons in public/icons were
# rendered from these with Playwright.
# StatSniper "S" mark, traced from the owner's design (1206x921 source). Mark centred on the circle.
cx,cy=613,437
top="M407 415 A206 206 0 0 1 595 113 L890 113 L785 235 L613 235 A202 202 0 0 0 407 415 Z"
bot="M805 460 A202 202 0 0 1 613 639 L425 640 L318 762 L628 762 A206 206 0 0 0 805 460 Z"
mark=f'<circle cx="{cx}" cy="{cy}" r="161"/><path d="{top}"/><path d="{bot}"/>'
open('overlay.svg','w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1206 921"><g fill="red" fill-opacity=".55">{mark}</g></svg>')
# square icon: mark scaled into a 512 box
s=0.62; # mark is ~572 wide x 649 tall in source units
def sq(bg, pad_scale, rx):
    k=512*pad_scale/649
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{bg}<g fill="#fff" transform="translate(256 256) scale({k:.4f}) translate(-604 -437.5)">{mark}</g></svg>'
open('logo.svg','w').write(sq('<rect width="512" height="512" rx="0" fill="#000"/>',0.72,0))
open('logo_mark.svg','w').write(sq('',0.98,0))
open('logo_maskable.svg','w').write(sq('<rect width="512" height="512" fill="#000"/>',0.56,0))

open('logo_header.svg','w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g fill="#fff" transform="translate(256 256) scale({512*0.62/649:.4f}) translate(-604 -437.5)">{mark}</g></svg>')
