const kst = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const formatTime = (time: number) => kst.format(time);
export const price = (value: number) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: 7 }).format(value);
export const money = (value: number) => value >= 1e8 ? `${(value / 1e8).toFixed(2)}억` : value >= 1e4 ? `${(value / 1e4).toFixed(1)}만` : value.toFixed(0);
export const percent = (value: number) => `${value.toFixed(2)}%`;
