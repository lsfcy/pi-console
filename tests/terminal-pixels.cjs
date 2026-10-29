// Browser-side geometry and Node-side screenshot ink analysis. No xterm private APIs.
function footerGeometry(id) {
  const view = views.get(id);
  const term = view.term;
  const screen = term.element.querySelector('.xterm-screen').getBoundingClientRect();
  const host = view.container.getBoundingClientRect();
  const main = document.getElementById('main-area').getBoundingClientRect();
  const bufferText = term.buffer.active.getLine(term.rows - 1).translateToString(false,0,term.cols);
  const shape = r => ({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height});
  let last, reference, rowRight = screen.right, clipRight = host.right;
  const row = term.element.querySelector('.xterm-rows')?.children[term.rows-1];
  if (view.rendererKind === 'dom' && row) {
    rowRight = row.getBoundingClientRect().right;
    const index = row.textContent.lastIndexOf('xhigh');
    const walker = document.createTreeWalker(row,NodeFilter.SHOW_TEXT);
    let node, offset=0;
    while(node=walker.nextNode()) {
      for(const [at,kind] of [[index+4,'last'],[index+1,'reference']]) {
        if(index>=0&&at>=offset&&at<offset+node.length) {
          const range=document.createRange();range.setStart(node,at-offset);range.setEnd(node,at-offset+1);
          if(kind==='last')last=shape(range.getBoundingClientRect());else reference=shape(range.getBoundingClientRect());
        }
      }
      offset+=node.length;
    }
    for(let element=row;element&&element!==view.container.parentElement;element=element.parentElement) {
      if(['hidden','clip','scroll','auto'].includes(getComputedStyle(element).overflowX)) clipRight=Math.min(clipRight,element.getBoundingClientRect().right);
    }
  } else {
    const cw=screen.width/term.cols,ch=screen.height/term.rows,y=screen.top+(term.rows-1)*ch;
    const cell=column=>({left:screen.left+column*cw,right:screen.left+(column+1)*cw,top:y,bottom:y+ch,width:cw,height:ch});
    last=cell(term.cols-1);reference=cell(term.cols-4);
  }
  return {renderer:view.rendererKind,columns:term.cols,rows:term.rows,text:bufferText.slice(-60),
    last,reference,rowRight,clipRight,hostRight:host.right,mainRight:main.right,
    screenRight:screen.right,cssWidth:innerWidth,background:term.options.theme.background};
}
function inkComparison(image, geometry) {
  const buffer=image.toBitmap();
  const size=image.getSize();
  const factor=Math.sqrt(buffer.length/4/(size.width*size.height));
  const width=Math.round(size.width*factor),height=Math.round(size.height*factor);
  const scale=width/geometry.cssWidth;
  const bg=geometry.background.slice(1).match(/../g).map(v=>parseInt(v,16));
  const ink=rect=>{
    let weight=0,pixels=0;
    for(let y=Math.max(0,Math.floor(rect.top*scale));y<Math.min(height,Math.ceil(rect.bottom*scale));y++) {
      for(let x=Math.max(0,Math.floor(rect.left*scale));x<Math.min(width,Math.ceil(rect.right*scale));x++) {
        const i=(y*width+x)*4;
        const delta=Math.abs(buffer[i+2]-bg[0])+Math.abs(buffer[i+1]-bg[1])+Math.abs(buffer[i]-bg[2]);
        if(delta>45){weight+=delta;pixels++;}
      }
    }
    return {weight,pixels};
  };
  const reference=ink(geometry.reference),last=ink(geometry.last);
  return {reference,last,ratio:reference.weight?last.weight/reference.weight:0};
}
module.exports={footerGeometry,inkComparison};
