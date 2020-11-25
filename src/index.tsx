function createTextElement(text: string): Fiber {
  return {
    type: "TEXT_ELEMENT",
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
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child)
      )
    }
  };
}

function createDom(fiber: Fiber) {
  const dom =
    fiber.type === "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(fiber.type!); // root fiber 没有 type，但是其 dom 就是传入的 container

  updateDom(dom, {}, fiber.props);

  return dom;
}

const isEvent = (key: string) => key.startsWith("on");
const isProperty = (key: string) => key !== "children" && !isEvent(key);
const isNew = (prev: object, next: object) => (key: string) =>
  prev[key] !== next[key];
const isGone = (prev: object, next: object) => (key: string) => !(key in next);
function updateDom(
  dom: HTMLElement | Text,
  prevProps: Fiber["props"],
  nextProps: Fiber["props"]
) {
  //Remove old or changed event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.removeEventListener(eventType, prevProps[name]);
    });

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = "";
    });

  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = nextProps[name];
    });

  // Add event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.addEventListener(eventType, nextProps[name]);
    });
}

function commitRoot() {
  // And then, when we are commiting the changes to the DOM, we also use the fibers from that array.
  deletions!.forEach(commitWork);
  // add nodes(the whole fiber tree) to dom
  commitWork(wipRoot!.child); // 调用的时候判断了 wipRoot 非空，注意这里是 child
  currentRoot = wipRoot;
  wipRoot = null;
}
function commitWork(fiber?: Fiber) {
  if (!fiber) {
    return;
  }

  // for function component
  let domParentFiber = fiber.parent!;
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent!;
  }
  const domParent = domParentFiber.dom;

  if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
    domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
    updateDom(fiber.dom, fiber.alternate!.props, fiber.props);
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent);
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

// for function component
function commitDeletion(fiber: Fiber, domParent: HTMLElement | Text) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child!, domParent);
  }
}

function render(element: Fiber, container: HTMLElement | Text) {
  wipRoot = {
    // keep track of the root of the fiber tree.
    dom: container,
    props: {
      children: [element]
    },
    alternate: currentRoot
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
}

type Fiber = {
  type?: string; // root fiber 没有 type
  dom?: HTMLElement | Text | null; // newFiber 的时候初始化为 null
  props: {
    // render 时将 [element] 作为 children 传入 root fiber；createElement中的 rest 参数也保证 children 一定存在且是数组
    children: Fiber[];
    nodeValue?: string; // for Text Node
  };
  parent?: Fiber;
  child?: Fiber;
  sibling?: Fiber;
  alternate?: Fiber | null; // This property is a link to the old fiber, the fiber that we committed to the DOM in the previous commit phase.
  effectTag?: string;
  hooks?: any[];
};
let nextUnitOfWork: Fiber | null | undefined = null;
let wipRoot: Fiber | null = null;
let currentRoot: Fiber | null = null; // last fiber tree we committed to the DOM
let deletions: Fiber[] | null = null;

function workLoop(deadline: any) {
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

function performUnitOfWork(fiber: Fiber): Fiber | undefined {
  const isFunctionComponent = fiber.type instanceof Function;
  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  // return next unit of work
  if (fiber.child) {
    return fiber.child;
  }
  let nextFiber: Fiber | undefined = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
}

let wipFiber: Fiber | null = null;
let hookIndex: number | null = null; //  keep track of the current hook index.

function updateFunctionComponent(fiber: Fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = []; // support calling useState several times in the same

  const children = [fiber.type(fiber.props)];
  reconcileChildren(fiber, children);
}

function useState(initial: any) {
  const oldHook =
    wipFiber!.alternate &&
    wipFiber!.alternate.hooks &&
    wipFiber!.alternate.hooks[hookIndex];
  const hook: any = {
    state: oldHook ? oldHook.state : initial,
    queue: []
  };

  const actions = oldHook ? oldHook.queue : [];
  actions.forEach((action: any) => {
    hook.state = action(hook.state);
  });

  const setState = (action: any) => {
    hook.queue.push(action);
    wipRoot = {
      // like render
      dom: currentRoot!.dom,
      props: currentRoot!.props,
      alternate: currentRoot!
    };
    nextUnitOfWork = wipRoot;
    deletions = [];
  };

  wipFiber!.hooks!.push(hook);
  hookIndex!++;
  return [hook.state, setState];
}

function updateHostComponent(fiber: Fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcileChildren(fiber, fiber.props.children);
}

// Here we will reconcile the old fibers with the new elements.
// The element is the thing we want to render to the DOM and the oldFiber is what we rendered the last time.
function reconcileChildren(wipFiber: Fiber, elements: Fiber[]) {
  // create new fibers
  let index = 0;
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  let prevSibling = null;

  while (index < elements.length || oldFiber != null) {
    const element = elements[index];
    let newFiber: Fiber | null = null;

    // compare oldFiber to element
    const sameType = oldFiber && element && element.type == oldFiber.type;

    if (sameType) {
      // update the node
      newFiber = {
        type: oldFiber!.type,
        props: element.props,
        dom: oldFiber!.dom,
        parent: wipFiber,
        alternate: oldFiber!,
        effectTag: "UPDATE"
      };
    }
    if (element && !sameType) {
      // add this node
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT"
      };
    }
    if (oldFiber && !sameType) {
      // delete the oldFiber's node
      oldFiber.effectTag = "DELETION";
      deletions!.push(oldFiber);
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }

    if (index === 0) {
      wipFiber.child = newFiber!;
    } else if (element) {
      prevSibling!.sibling = newFiber!; // 第0次循环，prevSibling 会被初始化
    }

    prevSibling = newFiber;
    index++;
  }
}

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
        setState((c) => c + 1);
      }}
    >
      Count: {state}
    </h1>
  );
}
const element = <Counter />;
const container = document.getElementById("root")!;
Didact.render(element, container);

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
