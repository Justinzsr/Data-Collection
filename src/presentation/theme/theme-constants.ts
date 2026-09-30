export const THEME_STORAGE_KEY = "moonarq-theme";

/** Runs before first paint (inlined in <head>) so a stored theme never flashes. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;
