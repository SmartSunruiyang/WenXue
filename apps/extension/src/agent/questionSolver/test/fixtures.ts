import type { ProductionVariantId } from '../manifest'

export interface PlatformFixtureSourceHeader {
	readonly familyTest: string
	readonly ocsjsPath: string
	readonly ocsjsSymbols: readonly string[]
	readonly selectors: readonly string[]
}

export interface ProductionPlatformFixture {
	readonly variant: ProductionVariantId
	readonly url: string
	readonly html: string
	readonly sourceHeader: PlatformFixtureSourceHeader
}

const CHAOXING_SOURCE = 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/cx.ts'
const ZHIHUISHU_SOURCE = 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/zhs.ts'
const ZJY_SOURCE = 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/zjy.ts'
const ICVE_SOURCE = 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/icve.ts'
const ICOURSE_SOURCE = 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/icourse.ts'
const UNIPUS_SOURCE = 'ocsjs/ocsjs-4.0/packages/scripts/src/projects/unipus/exploration.ts'
const UNIPUS_URL = 'https://ucontent.unipus.cn/_explorationpc_default/pc.html?task=1'

/**
 * Minimal DOM evidence for every production adapter.
 *
 * Each source header records the local family-test fixture that supplied the
 * URL/DOM shape plus the OCSJS file, symbols, and selectors attributed by the
 * adapter. These fixtures prove local contracts only; they are not live-site
 * evidence.
 */
export const PRODUCTION_PLATFORM_FIXTURES = [
	{
		variant: 'chaoxing.modern_work_exam',
		url: 'https://mooc1.chaoxing.com/mooc2/work/dowork?id=1',
		html: '<div class="questionLi" data-question-id="cx-q1"><input id="answertype-cx-q1" value="0"><h3>Which <img alt="shape"> is correct?</h3><div class="answerBg"><label class="answer_p" data-option-key="A"><input type="radio" name="q1" value="A">A. Circle</label><label class="answer_p" data-option-key="B"><input type="radio" name="q1" value="B">B. Square</label></div></div><button onclick="getTheNextQuestion(1)">下一题</button>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/chaoxing.test.ts#modernFixture',
			ocsjsPath: CHAOXING_SOURCE,
			ocsjsSymbols: ['workOrExam', 'workOrExamQuestionTitleTransform', 'readerAndFillHandle'],
			selectors: ['.questionLi', 'input[id^="answertype-"]', '.answerBg .answer_p'],
		},
	},
	{
		variant: 'chaoxing.chapter_test',
		url: 'https://mooc1.chaoxing.com/knowledge/cards?knowledgeId=1',
		html: '<div class="TiMu" data-question-id="chapter-q1"><input id="answertype-chapter-q1" value="11"><div class="Zy_TItle"><div class="clearfix">Match the pairs</div></div><div class="thirdUlList"><select class="dept_select"><option value="A">A</option><option value="B">B</option></select></div></div>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/chaoxing.test.ts#chapterFixture',
			ocsjsPath: CHAOXING_SOURCE,
			ocsjsSymbols: ['JobRunner.chapter', 'chapterTestTaskQuestionTitleTransform'],
			selectors: ['.TiMu', '.Zy_TItle .clearfix', '.thirdUlList .dept_select'],
		},
	},
	{
		variant: 'zhs.gxk_work_exam',
		url: 'https://online.zhihuishu.com/stuExamWeb.html#/webExamList/dohomework/1',
		html: '<div class="examPaper_subject" data-id="gxk"><div class="subject_type">单选题</div><div class="subject_describe"><div>GXK stem</div></div><div class="subject_node"><label class="nodeLab"><input type="radio" value="A">A. one</label></div></div>',
		sourceHeader: {
			familyTest: 'apps/extension/src/agent/questionSolver/platforms/zhihuishu.test.ts#CASES[0]',
			ocsjsPath: ZHIHUISHU_SOURCE,
			ocsjsSymbols: ['gxkWorkAndExam'],
			selectors: ['.examPaper_subject', '.subject_type', '.subject_node .nodeLab'],
		},
	},
	{
		variant: 'zhs.xnk_work',
		url: 'https://online.zhihuishu.com/atHomeworkExam/stu/homeworkQ/exerciseList',
		html: '<div class="questionBox"><div class="questionTit">多选题</div><div class="questionContent">XNK stem</div><div class="optionUl"><label><input type="checkbox" value="A">A. one</label></div></div>',
		sourceHeader: {
			familyTest: 'apps/extension/src/agent/questionSolver/platforms/zhihuishu.test.ts#CASES[1]',
			ocsjsPath: ZHIHUISHU_SOURCE,
			ocsjsSymbols: ['xnkWork'],
			selectors: ['.questionBox', '.questionContent', '.optionUl label'],
		},
	},
	{
		variant: 'zhs.smart_work',
		url: 'https://smartcourseexam.zhihuishu.com/ReviewExam',
		html: '<div class="questionContent"><div class="questionName"><span class="letterSortNum">单选题</span><div class="centent-pre">Smart stem</div></div><ul class="radio-view"><li class="clearfix"><input type="radio" value="A">A. one</li></ul></div>',
		sourceHeader: {
			familyTest: 'apps/extension/src/agent/questionSolver/platforms/zhihuishu.test.ts#CASES[2]',
			ocsjsPath: ZHIHUISHU_SOURCE,
			ocsjsSymbols: ['smartWork'],
			selectors: ['.questionContent', '.questionName .centent-pre', '.radio-view li.clearfix'],
		},
	},
	{
		variant: 'zhs.smart_exam',
		url: 'https://examloop.zhihuishu.com/exam/1',
		html: '<div class="question-area-content"><div class="flex items-center mb-[16px]">单选题</div><div class="flex-1"><div class="mb-[32px]"><div class="text-mainText font-medium">Exam stem</div></div></div><label class="user-select group"><input type="radio" value="A">A. one</label></div>',
		sourceHeader: {
			familyTest: 'apps/extension/src/agent/questionSolver/platforms/zhihuishu.test.ts#CASES[3]',
			ocsjsPath: ZHIHUISHU_SOURCE,
			ocsjsSymbols: ['smartExam'],
			selectors: [
				'.question-area-content',
				'.text-mainText.font-medium',
				'label.user-select.group',
			],
		},
	},
	{
		variant: 'zhs.fusioncourse_work',
		url: 'https://fusioncourseh5.zhihuishu.com/exam/1',
		html: '<div class="exam-item"><div class="quest-type">判断题</div><div class="quest-title"><div class="option-name">Fusion stem</div></div><label><input type="radio" value="A">正确</label></div>',
		sourceHeader: {
			familyTest: 'apps/extension/src/agent/questionSolver/platforms/zhihuishu.test.ts#CASES[4]',
			ocsjsPath: ZHIHUISHU_SOURCE,
			ocsjsSymbols: ['fusioncourseWork'],
			selectors: ['.exam-item', '.quest-type', '.quest-title .option-name'],
		},
	},
	{
		variant: 'zhs.hike_work',
		url: 'https://hike-teaching-center.polymas.com/stu-hike/stuHomeworkDo/1',
		html: '<div class="q_main"><div class="question_score">单选题</div><div class="question-topic">Hike stem</div><label><input type="radio" value="A">A. one</label></div>',
		sourceHeader: {
			familyTest: 'apps/extension/src/agent/questionSolver/platforms/zhihuishu.test.ts#CASES[5]',
			ocsjsPath: ZHIHUISHU_SOURCE,
			ocsjsSymbols: ['hikeWork'],
			selectors: ['.q_main', '.question_score', '.question-topic'],
		},
	},
	{
		variant: 'zhs.hike_homework',
		url: 'https://online.zhihuishu.com/stu/answer-homework/1',
		html: '<div class="question-item"><div class="title-box">问答题</div><div class="qeustion-content"><span>Homework stem <img src="diagram.png"></span></div><div class="vditor-content"><div class="vditor-reset" contenteditable="true"></div></div></div>',
		sourceHeader: {
			familyTest: 'apps/extension/src/agent/questionSolver/platforms/zhihuishu.test.ts#CASES[6]',
			ocsjsPath: ZHIHUISHU_SOURCE,
			ocsjsSymbols: ['hikeHomework'],
			selectors: ['.question-item', '.qeustion-content > span', '.vditor-content .vditor-reset'],
		},
	},
	{
		variant: 'zjy.legacy_work_exam',
		url: 'https://zyk.icve.com.cn/study/spockeepTest/1',
		html: '<div class="subjectList"><div class="subjectDet" data-id="zjy-1"><h3>Select all</h3><div class="optionList"><div data-option-key="A"><label><input type="checkbox" value="A">A. one</label></div><div data-option-key="B"><label><input type="checkbox" value="B">B. two</label></div></div></div></div>',
		sourceHeader: {
			familyTest: 'apps/extension/src/agent/questionSolver/platforms/vocational.test.ts#zjyFixture',
			ocsjsPath: ZJY_SOURCE,
			ocsjsSymbols: ['waitForQuestions', 'workOrExam'],
			selectors: ['.subjectList', '.subjectDet', '.optionList input'],
		},
	},
	{
		variant: 'icve.standard_work_exam',
		url: 'https://course.icve.com.cn/exam/1',
		html: '<div class="q_content" data-id="icve-1"><div class="divQuestionTitle">Explain</div><div class="questionOptions divTextarea"><iframe id="ueditor-1"></iframe></div></div><button class="paging_next">下一题</button>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/vocational.test.ts#icveUeditorFixture',
			ocsjsPath: ICVE_SOURCE,
			ocsjsSymbols: ['work'],
			selectors: ['.q_content', '.divQuestionTitle', 'iframe[id*="ueditor"]'],
		},
	},
	{
		variant: 'icve.ai_work',
		url: 'https://ai.icve.com.cn/preview-exam/1',
		html: '<div class="content-item" data-id="ai-1"><div class="questions-type">单选题</div><div class="questions-content"><div class="title-content-x">Pick the diagram</div></div><label class="group-item-a" data-option-key="A"><input type="radio" value="A"><img src="a.png"></label><label class="group-item-b" data-option-key="B"><input type="radio" value="B"><img src="b.png"></label></div><div class="center_btn"><button>上一题</button><button disabled>下一题</button></div>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/vocational.test.ts#icveAiFixture',
			ocsjsPath: ICVE_SOURCE,
			ocsjsSymbols: ['aiWork'],
			selectors: [
				'.content-item',
				'.questions-content [class*="title-content"]',
				'label[class*="group-item"]',
			],
		},
	},
	{
		variant: 'icourse.chapter_test',
		url: 'https://www.icourse163.org/learn/course-1#/learn/content?type=detail&id=chapter',
		html: '<div class="u-questionItem" data-id="course-q1"><div class="j-title"><div class="j-richTxt">Is <img src="graph.png"> increasing?</div></div><ul class="choices"><li data-option-key="A"><label><input type="radio" value="A"><i class="u-icon-correct"></i>对</label></li><li data-option-key="B"><label><input type="radio" value="B"><i class="u-icon-wrong"></i>错</label></li></ul></div>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/icourse.test.ts#standardFixture',
			ocsjsPath: ICOURSE_SOURCE,
			ocsjsSymbols: ['workAndExam', 'handleVideoTest'],
			selectors: ['.u-questionItem', '.j-title .j-richTxt', '.choices li'],
		},
	},
	{
		variant: 'icourse.work',
		url: 'https://www.icourse163.org/spoc/learn/course-1#/learn/quiz?id=work',
		html: '<div class="u-questionItem" data-id="course-q1"><div class="j-title"><div class="j-richTxt">Is <img src="graph.png"> increasing?</div></div><ul class="choices"><li data-option-key="A"><label><input type="radio" value="A"><i class="u-icon-correct"></i>对</label></li><li data-option-key="B"><label><input type="radio" value="B"><i class="u-icon-wrong"></i>错</label></li></ul></div>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/icourse.test.ts#standardFixture',
			ocsjsPath: ICOURSE_SOURCE,
			ocsjsSymbols: ['workAndExam'],
			selectors: ['.u-questionItem', '.j-title .j-richTxt', '.choices li'],
		},
	},
	{
		variant: 'icourse.exam',
		url: 'https://www.icourse163.org/learn/examObject?id=exam',
		html: '<div class="index-module__questionBody_x" data-id="exam-q1" data-question-type="判断"><div class="index-module__questionInfo_x">Exam statement</div><label class="index-module__optionBody_x" data-option-key="A"><input type="radio" value="A">对</label><label class="index-module__optionBody_x" data-option-key="B"><input type="radio" value="B">错</label></div>',
		sourceHeader: {
			familyTest: 'apps/extension/src/agent/questionSolver/platforms/icourse.test.ts#examFixture',
			ocsjsPath: ICOURSE_SOURCE,
			ocsjsSymbols: ['workAndExam'],
			selectors: [
				'[class*="questionBody"]',
				'[class*="questionInfo"]',
				'[class*="index-module__optionBody"]',
			],
		},
	},
	{
		variant: 'unipus.reading_fill',
		url: UNIPUS_URL,
		html: '<div class="layout-material-container">Passage <img src="passage.png"> text</div><div class="layout-reply-container"><div class="question-common-abs-reply"><div class="question-inputbox-header">Fill</div><div class="question-inputbox-body"><textarea id="rf-1"></textarea></div></div></div><button>下一题</button>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/unipus.test.ts#readingFillFixture',
			ocsjsPath: UNIPUS_SOURCE,
			ocsjsSymbols: ['doUnderstandingText'],
			selectors: [
				'.layout-material-container',
				'.question-common-abs-reply',
				'.question-inputbox-body textarea',
			],
		},
	},
	{
		variant: 'unipus.reading_choice',
		url: UNIPUS_URL,
		html: '<div class="layout-material-container">Before <img src="chart.png"> after</div><div class="layout-reply-container"><div class="question-common-abs-choice"><div class="ques-title">Choose</div><div class="option-wrap"><label class="option" data-option-key="A"><input type="radio" value="A"><span class="content">A. Alpha</span></label><label class="option" data-option-key="B"><input type="radio" value="B"><span class="content">B. before <img src="b.png"> after</span></label></div></div></div><button>下一题</button>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/unipus.test.ts#readingChoiceFixture',
			ocsjsPath: UNIPUS_SOURCE,
			ocsjsSymbols: ['doReading'],
			selectors: [
				'.layout-material-container',
				'.question-common-abs-choice',
				'.option-wrap .option',
			],
		},
	},
	{
		variant: 'unipus.normal_choice',
		url: UNIPUS_URL,
		html: '<div class="layout-reply-container"><div class="question-common-abs-choice"><div class="ques-title">多选: Choose</div><div class="option-wrap"><label class="option" data-option-key="A"><input type="checkbox" value="A"><span class="content">A. Alpha</span></label><label class="option" data-option-key="B"><input type="checkbox" value="B"><span class="content">B. Beta</span></label></div></div></div><button>下一题</button>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/unipus.test.ts#normalChoiceFixture',
			ocsjsPath: UNIPUS_SOURCE,
			ocsjsSymbols: ['doChoice'],
			selectors: ['.layout-reply-container', '.question-common-abs-choice', '.option-wrap .option'],
		},
	},
	{
		variant: 'unipus.completion_translation',
		url: UNIPUS_URL,
		html: '<div class="layout-reply-container"><div class="full"><div class="question-common-abs-reply"><div class="question-inputbox-header">翻译句子</div><div class="question-inputbox-body"><textarea id="ct-1"></textarea></div></div></div></div><button>下一题</button>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/unipus.test.ts#completionFixture',
			ocsjsPath: UNIPUS_SOURCE,
			ocsjsSymbols: ['job', 'doCompletion'],
			selectors: [
				'.layout-reply-container .full',
				'.question-common-abs-reply',
				'.question-inputbox-body textarea',
			],
		},
	},
	{
		variant: 'unipus.banked_cloze_input',
		url: UNIPUS_URL,
		html: '<div class="question-material-banked-cloze-scoop">Banked passage</div><div class="option-wrapper"><span class="option">alpha</span><span class="option">beta</span></div><div class="question-material-banked-cloze-reply"><div class="question-wrap"><div class="input-wrapper"><input id="bank-1"></div></div></div><button>下一题</button>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/unipus.test.ts#bankedInputFixture',
			ocsjsPath: UNIPUS_SOURCE,
			ocsjsSymbols: ['job', 'singleQuestionHandle'],
			selectors: [
				'.question-material-banked-cloze-reply',
				'.question-wrap .input-wrapper input',
				'.option-wrapper .option',
			],
		},
	},
	{
		variant: 'unipus.banked_cloze_dropdown',
		url: UNIPUS_URL,
		html: '<div class="question-wrap"><div class="question-title">Select words</div><div class="scoop-select-wrapper" data-blank-key="drop-1" data-selected-key="A"><div class="input-wrapper"><button class="ant-dropdown-trigger" data-value="A">A</button></div><i data-option-key="A">alpha</i><i data-option-key="B">beta</i></div></div><button>下一题</button>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/unipus.test.ts#dropdownFixture',
			ocsjsPath: UNIPUS_SOURCE,
			ocsjsSymbols: ['job', 'singleQuestionHandle'],
			selectors: [
				'.question-wrap',
				'.scoop-select-wrapper',
				'.input-wrapper .ant-dropdown-trigger',
			],
		},
	},
	{
		variant: 'unipus.free_fill',
		url: UNIPUS_URL,
		html: '<div class="layout-reply-container"><div class="question-title">Complete</div><div class="fe-scoop"><div class="scoop-input-wrapper"><input id="blank-1"></div></div></div><button>下一题</button>',
		sourceHeader: {
			familyTest:
				'apps/extension/src/agent/questionSolver/platforms/unipus.test.ts#freeFillFixture',
			ocsjsPath: UNIPUS_SOURCE,
			ocsjsSymbols: ['job', 'singleQuestionHandle'],
			selectors: ['.layout-reply-container', '.fe-scoop', '.scoop-input-wrapper input'],
		},
	},
	{
		variant: 'unipus.line_matching',
		url: UNIPUS_URL,
		html: '<div class="question-wrap"><div class="sequence-view">Order these</div><div class="sequence-reply-view"><div class="sequence-reply-view-item-text" data-id="A">Alpha</div><div class="sequence-reply-view-item-text" data-id="B">Beta</div><div class="sequence-reply-view-item-text" data-id="C">Gamma</div></div></div>',
		sourceHeader: {
			familyTest: 'apps/extension/src/agent/questionSolver/platforms/unipus.test.ts#lineFixture',
			ocsjsPath: UNIPUS_SOURCE,
			ocsjsSymbols: ['job', 'singleQuestionHandle'],
			selectors: ['.question-wrap', '.sequence-view', '.sequence-reply-view-item-text'],
		},
	},
] as const satisfies readonly ProductionPlatformFixture[]
