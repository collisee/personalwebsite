function handleResponsiveLayout() {
  const contentGrid = document.querySelector('.content-grid');
  let originalContent = contentGrid.innerHTML;
  let isMobileLayout = false;

  const moveToMobileLayout = () => {
    if (isMobileLayout) return;

    const elementsToMove = contentGrid.querySelectorAll('.section, .img-container');
    
    const fragment = document.createDocumentFragment();
    
    elementsToMove.forEach(element => {
      const newPane = document.createElement('div');
      newPane.className = 'pane';
      newPane.appendChild(element);
      fragment.appendChild(newPane);
    });

    contentGrid.innerHTML = '';
    contentGrid.appendChild(fragment);
    isMobileLayout = true;
  };

  const restoreDesktopLayout = () => {
    if (!isMobileLayout) return;

    contentGrid.innerHTML = originalContent;
    isMobileLayout = false;

    if (typeof updateTime === 'function') {
      updateTime();
    }
  };

  const checkLayout = () => {
    // console.log('checking layout');
    const isMobile = window.innerWidth < 1024;
    if (isMobile && !isMobileLayout) {
      moveToMobileLayout();
    } else if (!isMobile && isMobileLayout) {
      restoreDesktopLayout();
    }
  };
  
  checkLayout();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(checkLayout, 50);
  });
}


handleResponsiveLayout();
