type ReactElement = {
  type: string;
  props: {
    title: string;
    children: string;
  };
};

// const element = <h1 title="foo">Hello</h1>
const element: ReactElement = {
  type: "h1",
  props: {
    title: "foo",
    children: "Hello"
  }
};

const container = document.getElementById("root");

const node = document.createElement(element.type);
node["title"] = element.props.title;

const text = document.createTextNode("");
text["nodeValue"] = element.props.children;

node.appendChild(text);
container?.appendChild(node);
