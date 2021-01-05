/** requestIdleCallback */
// https://github.com/Microsoft/TypeScript/issues/21309#issuecomment-376338415
// https://ts.xcatliu.com/basics/declaration-files.html#declare-global
type RequestIdleCallbackHandle = any;
type RequestIdleCallbackOptions = {
  timeout: number;
};
type RequestIdleCallbackDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
};

interface Window {
  requestIdleCallback: (
    callback: (deadline: RequestIdleCallbackDeadline) => void,
    opts?: RequestIdleCallbackOptions
  ) => RequestIdleCallbackHandle;
  cancelIdleCallback: (handle: RequestIdleCallbackHandle) => void;
}

/** fiber 节点类型 */
type Fiber = {
  type: string | "TEXT_FIBER" | "ROOT_FIBER" | Function;

  /** 对应的dom节点 */
  dom?: HTMLElement | Text;
  props: {
    children: Fiber[];
    nodeValue?: string;
    [prop: string]: any;
  };

  /** fiber 树指针 */
  parent?: Fiber;
  child?: Fiber;
  sibling?: Fiber;
  alternate?: Fiber;

  /** 副作用标签 */
  effectTag?: "UPDATE" | "PLACEMENT" | "DELETION";

  /** 维护的hook列表 */
  hooks?: Hook<any>[];
};

/** 下一工作单元 */
let nextUnitOfWork: Fiber | undefined;
/** workInProgressRoot 正在处理的根fiber */
let wipRoot: Fiber | undefined;
/** dom中现在的根fiber，也就是上一次我们commit的根fiber */
let currentRoot: Fiber | undefined;
/** 每次构建 wipRoot 都要初始化，每次commit的时候要先执行（effectTag:"DELETION") */
let deletions: Fiber[] | undefined;

function createTextElement(text: string): Fiber {
  return {
    type: "TEXT_FIBER",
    props: {
      nodeValue: text,
      children: []
    }
  };
}

function createElement(
  type: string,
  props: Fiber["props"],
  ...children: (Fiber | string)[]
): Fiber {
  return {
    type,
    props: {
      ...props,
      children: children.map((fiberOrString) =>
        typeof fiberOrString === "object"
          ? fiberOrString
          : createTextElement(fiberOrString)
      )
    }
  };
}

/**
 * 根据fiber中的type，返回dom
 *
 * 注意FC没有dom
 */
function createDOMOf(fiber: Fiber): HTMLElement | Text {
  return fiber.type === "TEXT_FIBER"
    ? document.createTextNode("")
    : document.createElement(fiber.type as string);
}

const isEvent = (key: string) => key.startsWith("on"),
  isProperty = (key: string) => key !== "children" && !isEvent(key),
  isNew = <T extends object>(prev: T, next: T) => (key: keyof T) =>
    prev[key] !== next[key],
  isGone = <T extends object>(next: T) => (key: keyof T) => !(key in next),
  isNewOrGone = <T extends object>(prev: T, next: T) =>
    isNew<T>(prev, next) || isGone<T>(next);

/**
 * 更新fiber的dom属性
 */
function updateDOMOf(fiber: Fiber) {
  const dom = fiber.dom!,
    prevProps: Fiber["props"] = fiber.alternate?.props ?? { children: [] },
    nextProps = fiber.props;

  // remove old event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(isNewOrGone(prevProps, nextProps))
    .forEach((name) => {
      const eventName = name.toLowerCase().substring(2);
      dom.removeEventListener(eventName, prevProps[name]);
    });

  // remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(nextProps))
    .forEach((name) => {
      dom[name] = "";
    });

  // set new/changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = nextProps[name];
    });

  // add event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.addEventListener(eventType, nextProps[name]);
    });
}

/** 将dom附在fiber的dom字段上，并调用updateDOMOf进行一次更新 */
function attachDOM2(fiber: Fiber) {
  fiber.dom = createDOMOf(fiber);
  updateDOMOf(fiber);
}

/** 构建fiber树 */
function reconcileChildren(wipFiber: Fiber, elements: Fiber[]) {
  // create new fibers
  let index = 0;
  let oldFiber = wipFiber.alternate?.child;
  let prevSibling: Fiber | undefined;

  while (index < elements.length || oldFiber) {
    const fiber: Fiber | undefined = elements[index]; // 注意 fiber 可能不存在（while 的 oldFiber）
    let newFiber: Fiber | undefined;

    // compare oldFiber to fiber
    if (oldFiber && fiber && fiber.type === oldFiber.type) {
      // isSameType
      newFiber = {
        effectTag: "UPDATE",

        type: oldFiber.type,
        props: fiber.props,
        dom: oldFiber.dom,

        parent: wipFiber,
        alternate: oldFiber
      };
    } else {
      if (fiber) {
        newFiber = {
          effectTag: "PLACEMENT",

          type: fiber.type,
          props: fiber.props,
          dom: undefined,

          parent: wipFiber,
          alternate: undefined
        };
      }
      if (oldFiber) {
        // delete the oldFiber's node
        oldFiber.effectTag = "DELETION";
        deletions!.push(oldFiber);
      }
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else if (fiber) {
      // 能进入这个块 => index !== 0 && fiber，则之前位置的 fiber 都存在，所以 prevSibling!
      prevSibling!.sibling = newFiber; // fiber 则 newFiber 一定存在
    }

    prevSibling = newFiber;
    index++;
    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }
  }
}

/**
 * 更新Host组件
 * 
 * 先添加dom字段，然后调用reconcileChildren
 */
function updateHostComponent(fiber: Fiber) {
  if (!fiber.dom) {
    attachDOM2(fiber);
  }
  reconcileChildren(fiber, fiber.props.children);
}

type Hook<T> = {
  state: T;
  queue: Action<T>[];
};
type Action<T> = (state: T) => T;
type SetStateWithAction<T> = (action: Action<T>) => void;

let wipFiber: Fiber;
let hookIndex: number;

/**
 * 更新FC，调用 reconcileChildren，children通过调用函数获得
 * 
 * 
 */
function updateFunctionComponent(fiber: Fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];

  const fn = fiber.type as Function;
  const children = [fn(fiber.props)];
  reconcileChildren(fiber, children);
}

function useState<T>(initial: T): [T, SetStateWithAction<T>] {
  const oldHook = wipFiber.alternate?.hooks?.[hookIndex];
  const hook: Hook<T> = {
    state: oldHook ? oldHook.state : initial,
    queue: []
  };

  const actions = oldHook ? oldHook.queue : [];
  actions.forEach((action) => {
    hook.state = action(hook.state);
  });

  const setState: SetStateWithAction<T> = (action) => {
    hook.queue.push(action);

    // like in render
    wipRoot = {
      type: "ROOT_FIBER",
      dom: currentRoot.dom, // bug，currentRoot可能不存在
      props: currentRoot.props,
      alternate: currentRoot
    };
    deletions = [];
    nextUnitOfWork = wipRoot;
  };

  wipFiber.hooks!.push(hook); // wipFiber.hooks = []
  hookIndex++;
  return [hook.state, setState];
}

/**
 * 根据fiber类型进行更新，返回fiber树当前fiber的下一个（child、sibling）
 */
function performUnitOfWork(fiber: Fiber) {
  const isFunctionComponent = fiber.type instanceof Function;
  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  // return next unit of work
  if (fiber.child) {
    return fiber.child;
  } else {
    let nextFiber: Fiber | undefined = fiber;
    while (nextFiber) {
      if (nextFiber.sibling) {
        return nextFiber.sibling;
      } else {
        nextFiber = nextFiber.parent;
      }
    }
  }
}

/**
 * commit dom删除，递归调用
 * @param fiber 
 * @param domParent 
 */
function commitDeletion(fiber: Fiber, domParent: HTMLElement | Text) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child!, domParent);
  }
}
/**
 * 向dom提交（使用effectTag），递归调用
 * @param fiber 
 */
function commitWork(fiber?: Fiber) {
  if (!fiber) return;

  // for function component
  let domParentFiber = fiber.parent!; // commitWork(wipRoot.child);
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent!; // 只有 root fiber 没有 parent，但是有 dom
  }
  const domParent = domParentFiber.dom;

  if (fiber.effectTag === "PLACEMENT" && fiber.dom) {
    domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom) {
    updateDOMOf(fiber);
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent);
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function commitRoot() {
  deletions!.forEach(commitWork);
  commitWork(wipRoot!.child);
  currentRoot = wipRoot;
  wipRoot = undefined;
}

/**
 * 触发一次渲染过程
 * @param fiber 
 * @param container 
 */
function render(fiber: Fiber, container: Fiber["dom"]) {
  if (!container) {
    throw new Error("no container");
  }

  wipRoot = {
    type: "ROOT_FIBER",
    dom: container,
    props: {
      children: [fiber]
    },
    alternate: currentRoot
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
}

function workLoop(deadline: RequestIdleCallbackDeadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }

  window.requestIdleCallback(workLoop);
}
window.requestIdleCallback(workLoop);

const Didact = {
  createElement,
  render,
  useState
};

/** @jsx Didact.createElement */
function Counter() {
  const [state, setState] = Didact.useState(1);
  return (
    <h1
      onClick={() => {
        setState((c) => c + 1); // TODO: number
      }}
      style="user-select: none"
    >
      Count: {state}
    </h1>
  );
}
const element = <Counter />;
const container = document.getElementById("root")!;
Didact.render(element, container);
