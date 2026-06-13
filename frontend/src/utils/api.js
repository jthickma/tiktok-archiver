export const requestJson = async (url, options = {}, fallbackMessage = 'Request failed') => {
  const res = await fetch(url, options);
  let data;

  try {
    data = await res.json();
  } catch {
    throw new Error(fallbackMessage);
  }

  if (!res.ok) {
    throw new Error(data.error?.message || data.error || fallbackMessage);
  }

  return data;
};
