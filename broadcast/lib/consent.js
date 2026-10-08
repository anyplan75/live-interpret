const AGREE = 0;
const DECLINE = 1;

const consentText = {
  title: "설교 텍스트 저장 동의",
  message: "번역을 더 자연스럽고 정확하게 만들기 위해 설교 텍스트 교정 내용을 저장합니다.",
  detail: [
    "이 앱은 설교 음성을 저장하지 않습니다. 텍스트만 저장합니다.",
    "방송이 끝나면 그 설교자의 말 끊는 위치, 인식 교정, 더 정확한 번역 교정, 더 자연스러운 번역 교정, 용어를 저장해 다음 설교 번역에 다시 씁니다.",
    "저장한 내용은 이 교회 계정과 플랫폼 관리자가 볼 수 있습니다.",
    "동의하지 않으면 앱을 종료합니다. 이 질문은 앱을 켤 때마다 다시 묻습니다.",
  ].join("\n\n"),
  buttons: ["동의하고 계속", "동의하지 않음 (종료)"],
};

function consentDialogOptions() {
  return {
    type: "question",
    title: consentText.title,
    message: consentText.message,
    detail: consentText.detail,
    buttons: consentText.buttons.slice(),
    defaultId: AGREE,
    cancelId: DECLINE,
    noLink: true,
    normalizeAccessKeys: false,
  };
}

/** 매번 묻습니다. 동의 결과를 파일이나 설정에 남기지 않습니다. */
async function askConsent(dialog) {
  const result = await dialog.showMessageBox(consentDialogOptions());
  return Boolean(result) && result.response === AGREE;
}

module.exports = { consentText, consentDialogOptions, askConsent, AGREE, DECLINE };
