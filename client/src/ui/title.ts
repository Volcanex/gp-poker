import { useEffect } from 'react';

const SUFFIX = 'EveryonePoker';

/* Pass the page's own name; the product name is appended here so it is spelled
   one way. Pass null on a page that is still loading its name. */
export function useTitle(name: string | null) {
  useEffect(() => {
    document.title = name ? `${name}, ${SUFFIX}` : SUFFIX;
    return () => {
      document.title = SUFFIX;
    };
  }, [name]);
}
