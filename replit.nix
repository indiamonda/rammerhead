{ pkgs }: {
  deps = [
    pkgs.nodejs-18_x
    pkgs.nodePackages.npm
  ];
  
  # Ensure npm is in PATH
  shellHook = ''
    export PATH="${pkgs.nodejs-18_x}/bin:${pkgs.nodePackages.npm}/bin:$PATH"
  '';
}
