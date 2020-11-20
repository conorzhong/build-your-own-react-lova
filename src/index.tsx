type ReactElement = {
  type: string;
  props: ReactElementProps;
};
type ReactElementProps = {
  title?: string;
  children?: ReactElement[] | string;
  nodeValue?: string;
};

function createTextElement(text: string): ReactElement {
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
  props: ReactElementProps,
  ...children: ReactElement[]
): ReactElement {
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

const Didact = {
  createElement
};

/** @jsx Didact.createElement */
const element = (
  <div id="foo">
    <a>bar</a>
    <b />
  </div>
);
const container = document.getElementById("root");
ReactDOM.render(element, container);
