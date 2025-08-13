function updateLunarDate() {
  
  const lunarFormatter = new Intl.DateTimeFormat('vi-VN-u-ca-chinese', {
    timeZone: "Asia/Ho_Chi_Minh",
    day: 'numeric',
    month: 'numeric',
    year: 'numeric'
  });
  
  const canChi = [
      'Giáp Tý', 'Ất Sửu', 'Bính Dần', 'Đinh Mão', 'Mậu Thìn', 'Kỷ Tỵ',
      'Canh Ngọ', 'Tân Mùi', 'Nhâm Thân', 'Quý Dậu', 'Giáp Tuất', 'Ất Hợi',
      'Bính Tý', 'Đinh Sửu', 'Mậu Dần', 'Kỷ Mão', 'Canh Thìn', 'Tân Tỵ',
      'Nhâm Ngọ', 'Quý Mùi', 'Giáp Thân', 'Ất Dậu', 'Bính Tuất', 'Đinh Hợi',
      'Mậu Tý', 'Kỷ Sửu', 'Canh Dần', 'Tân Mão', 'Nhâm Thìn', 'Quý Tỵ',
      'Giáp Ngọ', 'Ất Mùi', 'Bính Thân', 'Đinh Dậu', 'Mậu Tuất', 'Kỷ Hợi',
      'Canh Tý', 'Tân Sửu', 'Nhâm Dần', 'Quý Mão', 'Giáp Thìn', 'Ất Tỵ',
      'Bính Ngọ', 'Đinh Mùi', 'Mậu Thân', 'Kỷ Dậu', 'Canh Tuất', 'Tân Hợi',
      'Nhâm Tý', 'Quý Sửu', 'Giáp Dần', 'Ất Mão', 'Bính Thìn', 'Đinh Tỵ',
      'Mậu Ngọ', 'Kỷ Mùi', 'Canh Thân', 'Tân Dậu', 'Nhâm Tuất', 'Quý Hợi'
  ];

  const lunarParts = lunarFormatter.formatToParts(new Date());
  // console.log("Lunar parts:", lunarParts);

  const day = parseInt(lunarParts.find(part => part.type === 'day').value);
  const month = parseInt(lunarParts.find(part => part.type === 'month').value);
  const year = parseInt(lunarParts.find(part => part.type === 'relatedYear').value);
  const zodiacYear = canChi[(year - 1804) % 60];
  const dayText = day <= 10 ? `Mùng ${day}` : `Ngày ${day}`;
  const lunarFormatted = `ÂL: ${dayText} Tháng ${month} Năm ${year} (${zodiacYear})`;
  document.getElementById("lunardate").textContent = lunarFormatted;
}

function updateDate() {
  const today = new Date();
  const formatted = today.toLocaleDateString("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  document.getElementById("date").textContent = formatted;
};

function updateTime() {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  document.getElementById("time").textContent = time;
}

function getRandom(min, max) {
  return Math.random() * (max - min) + min;
}

function scatterText(element) {
  const text = element.textContent;
  element.innerHTML = "";

  [...text].forEach((char) => {
    const span = document.createElement("span");
    span.textContent = char === " " ? "\u00A0" : char;
    span.style.display = "inline-block";
    span.style.transform = `
            translateY(${getRandom(-0.8, 0.8)}vw)
            rotate(${getRandom(-10, 10)}deg)
        `;
    span.style.transition = "transform 0.3s ease";
    span.style.textShadow = "inherit";
    element.appendChild(span);
  });
}

document.addEventListener("DOMContentLoaded", function () {
  updateTime();
  setInterval(updateTime, 1000);

  const scatterElement = document.getElementById("scatterText");
  if (scatterElement) {
    scatterText(scatterElement);
  }

  updateDate();
  updateLunarDate();
});